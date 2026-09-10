const { sendSuccess, sendError } = require('../../utils/helpers');
const Invoice     = require('../../models/Finance Management/Invoice');
const Dispatch    = require('../../models/Marketplace Management/Dispatch');
const Transaction = require('../../models/Finance Management/Transaction');
const { generateOtp, storeOtp, verifyOtp } = require('../../utils/otp');
const Employee = require('../../models/HR Management/Employee');
const User     = require('../../models/User Management/User');

// Generate the next transaction code (TXN-0001, TXN-0002, …)
async function nextTxnCode() {
  const last = await Transaction.findOne({ txn_code: /^TXN-/ }).sort({ txn_code: -1 }).lean();
  const num = last?.txn_code ? parseInt(last.txn_code.split('-')[1], 10) : 0;
  return `TXN-${String(num + 1).padStart(4, '0')}`;
}

// ── Helper: auto-generate next invoice number ─────────────────
async function generateInvoiceNo(companyId) {
  const last = await Invoice.findOne(
    { company_id: companyId, invoice_no: /^INV-/ },
    { invoice_no: 1 }
  ).sort({ created_at: -1 }).lean();

  const num = last?.invoice_no ? parseInt(last.invoice_no.split('-')[1], 10) : 0;
  return `INV-${String(num + 1).padStart(4, '0')}`;
}

// ── Helper: recalculate balance & payment_status ──────────────
function resolvePaymentStatus(grandTotal, paidAmount) {
  const balance = Math.max(0, grandTotal - paidAmount);
  let payment_status = 'Unpaid';
  if (paidAmount >= grandTotal) {
    payment_status = 'Paid';
  } else if (paidAmount > 0) {
    payment_status = 'Partially Paid';
  }
  return { balance_due: balance, payment_status };
}

// ── GET /api/invoices ─────────────────────────────────────────
async function listInvoices(req, res) {
  const { search, status, payment_status, customer_id, from_date, to_date, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = { company_id: req.user.company_id };

  // Staff App + customer_id: customer detail screen wants the FULL invoice
  // history for this customer regardless of assignment.
  if (req.isStaffApp && customer_id) {
    query.customer_id = customer_id;
  } else if (req.isStaffApp) {
    // Staff App: show invoices linked to orders assigned to this staff user,
    // PLUS any invoice where this staff recorded a payment (so their own
    // collections — and the verification OTP — are always visible to them).
    const Order = require('../../models/Marketplace Management/Order');
    const assignedOrders = await Order.find(
      { company_id: req.user.company_id, assigned_to: req.user._id },
      { order_code: 1 }
    ).lean();
    const assignedOrderCodes = assignedOrders.map(o => o.order_code).filter(Boolean);

    const orConditions = [];
    if (assignedOrderCodes.length) {
      orConditions.push({ order_no: { $in: assignedOrderCodes } });
    }
    // Invoices this staff collected a payment against.
    orConditions.push({ 'payment_history.received_by': req.user._id });

    // If there are no assigned orders AND no collected payments, return empty.
    if (orConditions.length === 0) {
      return sendSuccess(res, { invoices: [], total: 0, page: 1, limit: parseInt(limit) });
    }
    query.$or = orConditions;
  }

  if (status)         query.status         = status;
  if (payment_status) query.payment_status = payment_status;
  if (from_date || to_date) {
    query.invoice_date = {};
    if (from_date) query.invoice_date.$gte = new Date(from_date);
    if (to_date)   query.invoice_date.$lte = new Date(to_date);
  }
  if (search) {
    const searchOr = [
      { invoice_no:     { $regex: search, $options: 'i' } },
      { customer_name:  { $regex: search, $options: 'i' } },
      { customer_phone: { $regex: search, $options: 'i' } },
      { quotation_no:   { $regex: search, $options: 'i' } },
      { order_no:       { $regex: search, $options: 'i' } },
    ];
    if (query.$or) {
      // A staff visibility $or already exists — combine both with $and so we
      // don't clobber it (invoice must match staff scope AND the search term).
      query.$and = [{ $or: query.$or }, { $or: searchOr }];
      delete query.$or;
    } else {
      query.$or = searchOr;
    }
  }

  const [total, invoices] = await Promise.all([
    Invoice.countDocuments(query),
    Invoice.find(query)
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(parseInt(limit))
      .lean(),
  ]);

  // Backfill any missing "collected by" names from the User records so the
  // Staff App / CRM always show who collected each payment.
  await backfillCollectorNames(invoices);

  sendSuccess(res, {
    invoices,
    total,
    page: parseInt(page),
    limit: parseInt(limit),
    pages: Math.ceil(total / parseInt(limit)),
  });
}

// ── Helper: fill in received_by_name on payment_history entries ─
// Payments recorded before the name was captured (or where the staff User
// had no name) may have an empty received_by_name. Resolve it from the User
// collection so the "Collected By" info is never blank in the UI.
async function backfillCollectorNames(invoices) {
  const list = Array.isArray(invoices) ? invoices : [invoices];
  const missingIds = [];
  list.forEach(inv =>
    (inv?.payment_history || []).forEach(ph => {
      if (!ph.received_by_name && ph.received_by) missingIds.push(String(ph.received_by));
    })
  );
  if (!missingIds.length) return;

  const users = await User.find({ _id: { $in: [...new Set(missingIds)] } })
    .select('name email mobile')
    .lean();
  const byId = {};
  users.forEach(u => { byId[String(u._id)] = u.name || u.email || u.mobile || 'Staff'; });

  list.forEach(inv =>
    (inv?.payment_history || []).forEach(ph => {
      if (!ph.received_by_name && ph.received_by) {
        ph.received_by_name = byId[String(ph.received_by)] || '';
      }
    })
  );
}

// ── GET /api/invoices/:id ─────────────────────────────────────
async function getInvoice(req, res) {
  // Accept either a Mongo _id or a human invoice_no (e.g. "INV-0002"), since
  // the staff app sometimes navigates by invoice number.
  const idParam = String(req.params.id || '');
  const isObjectId = /^[0-9a-fA-F]{24}$/.test(idParam);
  const lookup = isObjectId
    ? { _id: idParam, company_id: req.user.company_id }
    : { invoice_no: idParam, company_id: req.user.company_id };

  const invoice = await Invoice.findOne(lookup).lean();
  if (!invoice) return sendError(res, 'Invoice not found.', 404);

  // ── Resolve linked dispatch ───────────────────────────────
  // Priority 1: dispatch_id stored directly on the invoice (new invoices).
  // Priority 2: look up Dispatch by order_id (covers all auto-created invoices
  //             that existed before dispatch_id was added to the model).
  let dispatch = null;
  if (invoice.dispatch_id) {
    dispatch = await Dispatch.findById(invoice.dispatch_id)
      .select('dispatch_code order_id status driver_name driver_mobile vehicle_number lr_number transport_name dispatch_date expected_delivery delivered_date notes')
      .lean();
  }
  if (!dispatch && invoice.order_id) {
    dispatch = await Dispatch.findOne({ order_id: invoice.order_id })
      .select('dispatch_code order_id status driver_name driver_mobile vehicle_number lr_number transport_name dispatch_date expected_delivery delivered_date notes')
      .lean();
  }

  // Fill in any missing "collected by" names.
  await backfillCollectorNames(invoice);

  sendSuccess(res, { ...invoice, dispatch: dispatch || null });
}

// ── POST /api/invoices ────────────────────────────────────────
async function createInvoice(req, res) {
  const body = req.body;

  // Auto-number if not provided
  const invoice_no = (body.invoice_no || '').trim() || await generateInvoiceNo(req.user.company_id);

  const grand_total  = parseFloat(body.grand_total)  || 0;
  const paid_amount  = parseFloat(body.paid_amount)  || 0;
  const { balance_due, payment_status } = resolvePaymentStatus(grand_total, paid_amount);

  const invoice = await Invoice.create({
    company_id:       req.user.company_id,
    invoice_no,

    // Source refs
    quotation_id:     body.quotation_id     || null,
    quotation_no:     body.quotation_no     || '',
    sale_id:          body.sale_id          || null,
    sale_code:        body.sale_code        || '',
    order_id:         body.order_id         || null,
    order_no:         body.order_no         || '',
    dispatch_id:      body.dispatch_id      || null,
    dispatch_code:    body.dispatch_code    || '',

    // Customer
    customer_id:      body.customer_id      || null,
    customer_name:    body.customer_name    || '',
    customer_phone:   body.customer_phone   || '',
    customer_email:   body.customer_email   || '',
    billing_address:  body.billing_address  || '',
    shipping_address: body.shipping_address || '',
    gstin:            body.gstin            || '',

    // Dates
    invoice_date:     body.invoice_date     || new Date(),
    due_date:         body.due_date         || null,

    // Items
    items:            Array.isArray(body.items) ? body.items : [],

    // Financials
    freight_charges:  parseFloat(body.freight_charges)  || 0,
    other_charges:    parseFloat(body.other_charges)    || 0,
    subtotal:         parseFloat(body.subtotal)         || 0,
    discount_amount:  parseFloat(body.discount_amount)  || 0,
    gst_amount:       parseFloat(body.gst_amount)       || 0,
    round_off:        parseFloat(body.round_off)        || 0,
    grand_total,
    paid_amount,
    balance_due,
    payment_status,
    payment_history:  Array.isArray(body.payment_history) ? body.payment_history : [],

    // Meta
    remarks:          body.remarks    || '',
    terms:            body.terms      || '',
    status:           'draft',
    created_by:       req.user._id,
  });

  sendSuccess(res, invoice, 'Invoice created.', 201);
}

// ── PUT /api/invoices/:id ─────────────────────────────────────
async function updateInvoice(req, res) {
  const body   = req.body;
  const update = {};

  const fields = [
    'quotation_id', 'quotation_no', 'sale_id', 'sale_code', 'order_id', 'order_no',
    'dispatch_id', 'dispatch_code',
    'customer_id', 'customer_name', 'customer_phone', 'customer_email',
    'billing_address', 'shipping_address', 'gstin',
    'invoice_date', 'due_date',
    'freight_charges', 'other_charges', 'subtotal', 'discount_amount',
    'gst_amount', 'round_off', 'grand_total', 'paid_amount',
    'remarks', 'terms',
  ];

  fields.forEach((f) => {
    if (body[f] !== undefined) {
      const numericFields = [
        'freight_charges', 'other_charges', 'subtotal', 'discount_amount',
        'gst_amount', 'round_off', 'grand_total', 'paid_amount',
      ];
      update[f] = numericFields.includes(f) ? parseFloat(body[f]) || 0 : body[f];
    }
  });

  if (body.items !== undefined) {
    update.items = Array.isArray(body.items) ? body.items : [];
  }

  // Recalculate balance when financials change
  const existing = await Invoice.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
  if (!existing) return sendError(res, 'Invoice not found.', 404);

  const grand_total = update.grand_total ?? existing.grand_total;
  const paid_amount = update.paid_amount ?? existing.paid_amount;
  const { balance_due, payment_status } = resolvePaymentStatus(grand_total, paid_amount);
  update.balance_due    = balance_due;
  update.payment_status = payment_status;

  const invoice = await Invoice.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    update,
    { new: true }
  ).lean();

  sendSuccess(res, invoice, 'Invoice updated.');
}

// ── PATCH /api/invoices/:id/status ────────────────────────────
async function updateInvoiceStatus(req, res) {
  const VALID = ['draft', 'sent', 'paid', 'partially_paid', 'overdue', 'cancelled'];
  const { status } = req.body;
  if (!status || !VALID.includes(status)) {
    return sendError(res, `Invalid status. Valid values: ${VALID.join(', ')}`);
  }

  const invoice = await Invoice.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    { status },
    { new: true }
  ).lean();
  if (!invoice) return sendError(res, 'Invoice not found.', 404);
  sendSuccess(res, invoice, `Invoice status updated to "${status}".`);
}

// ── POST /api/invoices/:id/payment ────────────────────────────
// Record a payment against the invoice
async function recordPayment(req, res) {
  const { amount, payment_date, payment_mode, reference_no, note } = req.body;
  if (!amount || parseFloat(amount) <= 0) {
    return sendError(res, 'Payment amount must be greater than 0.');
  }

  const invoice = await Invoice.findOne({ _id: req.params.id, company_id: req.user.company_id });
  if (!invoice) return sendError(res, 'Invoice not found.', 404);
  if (invoice.status === 'cancelled') {
    return sendError(res, 'Cannot record payment for a cancelled invoice.');
  }

  const paymentEntry = {
    amount:           parseFloat(amount),
    payment_date:     payment_date || new Date(),
    payment_mode:     payment_mode || 'Cash',
    reference_no:     reference_no || '',
    note:             note         || '',
    received_by:      req.user._id,
    received_by_name: req.user.name || req.user.email || req.user.mobile || 'Staff',
  };

  invoice.payment_history.push(paymentEntry);
  invoice.paid_amount += parseFloat(amount);

  const { balance_due, payment_status } = resolvePaymentStatus(invoice.grand_total, invoice.paid_amount);
  invoice.balance_due    = balance_due;
  invoice.payment_status = payment_status;

  // Sync status field too
  if (payment_status === 'Paid') {
    invoice.status = 'paid';
  } else if (payment_status === 'Partially Paid') {
    invoice.status = 'partially_paid';
  }

  await invoice.save();
  sendSuccess(res, invoice, 'Payment recorded successfully.');
}

// ── DELETE /api/invoices/:id ──────────────────────────────────
async function deleteInvoice(req, res) {
  const result = await Invoice.deleteOne({ _id: req.params.id, company_id: req.user.company_id });
  if (result.deletedCount === 0) return sendError(res, 'Invoice not found.', 404);
  sendSuccess(res, null, 'Invoice deleted.');
}

// ── GET /api/invoices/summary ─────────────────────────────────
// Quick financial summary for dashboard widgets
async function getInvoiceSummary(req, res) {
  const companyId = req.user.company_id;

  const agg = await Invoice.aggregate([
    { $match: { company_id: companyId, status: { $ne: 'cancelled' } } },
    {
      $group: {
        _id: null,
        total_invoices: { $sum: 1 },
        total_amount:   { $sum: '$grand_total' },
        paid_amount:    { $sum: '$paid_amount' },
        balance_due:    { $sum: '$balance_due' },
      },
    },
  ]);

  const byStatus = await Invoice.aggregate([
    { $match: { company_id: companyId } },
    { $group: { _id: '$payment_status', count: { $sum: 1 }, amount: { $sum: '$grand_total' } } },
  ]);

  sendSuccess(res, {
    summary: agg[0] || { total_invoices: 0, total_amount: 0, paid_amount: 0, balance_due: 0 },
    by_status: byStatus,
  });
}

// ── GET /api/invoices/staff-collections ──────────────────────
// Returns ALL invoices that have staff-recorded payments, with full
// payment history. Includes Pending, OTP Sent, and Verified entries.
// Used by Admin/Accounts to see everything and verify.
async function listPendingVerification(req, res) {
  const { status = 'all' } = req.query; // all | pending | verified

  // Find invoices that have at least one payment_history entry
  const invoices = await Invoice.find({
    company_id: req.user.company_id,
    'payment_history.0': { $exists: true }, // has at least one payment
  })
    .select('invoice_no customer_name customer_phone order_no payment_history paid_amount grand_total balance_due payment_status invoice_date')
    .sort({ 'payment_history.payment_date': -1, created_at: -1 })
    .lean();

  // Flatten into one entry per payment_history item
  // Pre-resolve staff names for any payment missing received_by_name, so the
  // "Collected By" column always shows who collected the money.
  const missingNameIds = [];
  invoices.forEach(inv =>
    (inv.payment_history || []).forEach(ph => {
      if (!ph.received_by_name && ph.received_by) missingNameIds.push(String(ph.received_by));
    })
  );
  const nameById = {};
  if (missingNameIds.length) {
    const users = await User.find({ _id: { $in: [...new Set(missingNameIds)] } })
      .select('name')
      .lean();
    users.forEach(u => { nameById[String(u._id)] = u.name || ''; });
  }

  const entries = [];
  invoices.forEach(inv => {
    // Order this invoice's payments oldest-first so we can number them
    // (1st payment, 2nd payment, …) and compute the running balance.
    const history = [...(inv.payment_history || [])].sort(
      (a, b) => new Date(a.payment_date) - new Date(b.payment_date)
    );
    let runningPaid = 0;

    history.forEach((ph, idx) => {
      runningPaid += (ph.amount || 0);
      const balanceAfter = Math.max(0, (inv.grand_total || 0) - runningPaid);

      // Treat missing verification_status as 'Pending' (backward compat)
      const vStatus = ph.verification_status || 'Pending';

      // Apply status filter
      if (status === 'pending' && vStatus === 'Verified') return;
      if (status === 'verified' && vStatus !== 'Verified') return;

      const collectedBy =
        ph.received_by_name ||
        (ph.received_by ? nameById[String(ph.received_by)] : '') ||
        '';

      entries.push({
        invoice_id:          String(inv._id),
        invoice_no:          inv.invoice_no,
        customer_name:       inv.customer_name,
        customer_phone:      inv.customer_phone || '',
        order_no:            inv.order_no || '',
        invoice_date:        inv.invoice_date,
        invoice_grand_total: inv.grand_total,
        invoice_paid:        inv.paid_amount,
        invoice_balance:     inv.balance_due,
        payment_status:      inv.payment_status,
        payment_id:          String(ph._id),
        amount:              ph.amount,
        // Per-payment sequence + running balance for clear multi-payment view
        payment_seq:         idx + 1,                 // 1 = first payment, 2 = second, …
        payment_count:       history.length,          // total payments on this invoice
        running_paid:        runningPaid,             // cumulative paid up to & incl. this payment
        balance_after:       balanceAfter,            // invoice balance right after this payment
        payment_mode:        ph.payment_mode || 'Cash',
        reference_no:        ph.reference_no || '',
        note:                ph.note || '',
        payment_date:        ph.payment_date,
        received_by:         ph.received_by ? String(ph.received_by) : null,
        received_by_name:    collectedBy,
        verification_status: vStatus,
        verified_by_name:    ph.verified_by_name || '',
        verified_at:         ph.verified_at || null,
        otp_sent_at:         ph.otp_sent_at || null,
      });
    });
  });

  // Sort newest payment first
  entries.sort((a, b) => new Date(b.payment_date) - new Date(a.payment_date));

  const pending  = entries.filter(e => e.verification_status !== 'Verified').length;
  const verified = entries.filter(e => e.verification_status === 'Verified').length;
  const totalAmt = entries.reduce((s, e) => s + (e.amount || 0), 0);

  sendSuccess(res, {
    collections: entries,
    total:    entries.length,
    pending,
    verified,
    total_amount: totalAmt,
  });
}

// ── POST /api/invoices/:id/payment/:phId/send-otp ─────────────
// Admin clicks "Verify" → sends OTP to the staff member's registered mobile.
// Purpose stored in OtpStore: 'collection_verify'
async function sendVerificationOtp(req, res) {
  const invoice = await Invoice.findOne({ _id: req.params.id, company_id: req.user.company_id });
  if (!invoice) return sendError(res, 'Invoice not found.', 404);

  const ph = invoice.payment_history.id(req.params.phId);
  if (!ph) return sendError(res, 'Payment entry not found.', 404);
  if (ph.verification_status === 'Verified') return sendError(res, 'Already verified.', 400);

  // Look up the staff member's mobile from their User/Employee record.
  // The mobile is only needed to (a) key the hashed OTP store and (b) send an
  // SMS once a gateway exists. The staff reads the OTP from their app either way,
  // so a missing mobile must NOT block generating the OTP.
  let mobile = '';
  if (ph.received_by) {
    const user = await User.findById(ph.received_by).select('mobile').lean();
    if (user?.mobile) mobile = user.mobile;
  }
  if (!mobile && ph.received_by_name) {
    // Fall back: find employee by name within the company
    const emp = await Employee.findOne({
      company_id: req.user.company_id,
      name: { $regex: ph.received_by_name, $options: 'i' },
    }).select('mobile').lean();
    if (emp?.mobile) mobile = emp.mobile;
  }

  const OTP_PURPOSE = 'collection_verify';
  const otp = generateOtp();
  // Key the hashed OTP store by mobile when available, otherwise by a stable
  // per-payment key so verification still works.
  const otpTarget = mobile || `payment:${ph._id}`;
  await storeOtp(otpTarget, otp, OTP_PURPOSE, 'mobile');

  // Mark OTP sent on the payment entry. Store the plaintext OTP so the
  // collecting staff can read it inside their app (they are the recipient).
  ph.verification_status = 'OTP Sent';
  ph.otp_sent_at         = new Date();
  ph.otp_code            = otp;
  await invoice.save();

  console.log(`\n========================================`);
  console.log(`  COLLECTION VERIFY OTP`);
  console.log(`  invoice=${invoice.invoice_no} payment=${ph._id}`);
  console.log(`  staff="${ph.received_by_name || ''}" mobile="${mobile || '(none — app only)'}"`);
  console.log(`  OTP: ${otp}`);
  console.log(`========================================\n`);

  const devReturn = process.env.OTP_DEV_RETURN === 'true' && process.env.NODE_ENV !== 'production';
  sendSuccess(res, {
    sent:    true,
    mobile:  mobile || '',
    staff:   ph.received_by_name || '',
    ...(devReturn ? { otp } : {}),
  }, mobile
    ? `OTP sent to ${ph.received_by_name || 'staff'}`
    : `OTP generated for ${ph.received_by_name || 'staff'} — ask them to read it from their app`);
}

// ── POST /api/invoices/:id/payment/:phId/verify ───────────────
// Admin enters the OTP the staff member read out → verify and mark payment verified.
async function verifyPayment(req, res) {
  const { otp } = req.body;
  if (!otp) return sendError(res, 'OTP is required.');

  const invoice = await Invoice.findOne({ _id: req.params.id, company_id: req.user.company_id });
  if (!invoice) return sendError(res, 'Invoice not found.', 404);

  const ph = invoice.payment_history.id(req.params.phId);
  if (!ph) return sendError(res, 'Payment entry not found.', 404);
  if (ph.verification_status === 'Verified') return sendError(res, 'Already verified.', 400);
  if (ph.verification_status !== 'OTP Sent') return sendError(res, 'Send OTP first.', 400);

  // Resolve the same OTP target used at send time (mobile, or per-payment key).
  let mobile = '';
  if (ph.received_by) {
    const user = await User.findById(ph.received_by).select('mobile').lean();
    if (user?.mobile) mobile = user.mobile;
  }
  if (!mobile && ph.received_by_name) {
    const emp = await Employee.findOne({
      company_id: req.user.company_id,
      name: { $regex: ph.received_by_name, $options: 'i' },
    }).select('mobile').lean();
    if (emp?.mobile) mobile = emp.mobile;
  }
  const otpTarget = mobile || `payment:${ph._id}`;

  const result = await verifyOtp(otpTarget, String(otp), 'collection_verify');
  if (!result.valid) return sendError(res, result.reason || 'Invalid or expired OTP.', 400);

  ph.verification_status = 'Verified';
  ph.verified_by         = req.user._id;
  ph.verified_by_name    = req.user.name || '';
  ph.verified_at         = new Date();
  ph.otp_code            = '';   // clear the displayed OTP once verified
  await invoice.save();

  // Post the verified collection to the Transaction ledger so it appears in
  // Transaction History and the "Received (Loaded)" totals. Guard against
  // duplicates using the payment_history _id as reference_id.
  try {
    const already = await Transaction.findOne({
      company_id: req.user.company_id,
      reference_id: ph._id,
      type: 'Received',
    }).lean();
    if (!already) {
      await Transaction.create({
        txn_code:     await nextTxnCode(),
        company_id:   req.user.company_id,
        type:         'Received',
        party_name:   invoice.customer_name || '',
        reference_id: ph._id,
        amount:       ph.amount,
        mode:         ph.payment_mode || 'Cash',
        reference:    ph.reference_no || invoice.invoice_no || '',
        notes:        `Collected by ${ph.received_by_name || 'staff'} · verified by ${ph.verified_by_name || 'admin'} · ${invoice.invoice_no}`,
        txn_date:     ph.verified_at,
        recorded_by:  req.user._id,
      });
    }
  } catch (e) {
    console.error('[verifyPayment] Failed to post transaction:', e.message);
    // Non-fatal: verification still succeeded.
  }

  sendSuccess(res, {
    verified:        true,
    invoice_no:      invoice.invoice_no,
    payment_amount:  ph.amount,
    received_by:     ph.received_by_name,
    verified_by:     ph.verified_by_name,
    verified_at:     ph.verified_at,
  }, 'Payment verified successfully.');
}

module.exports = {
  listInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  updateInvoiceStatus,
  recordPayment,
  deleteInvoice,
  getInvoiceSummary,
  listPendingVerification,
  sendVerificationOtp,
  verifyPayment,
};
