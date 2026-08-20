const { sendSuccess, sendError } = require('../../utils/helpers');
const Invoice = require('../../models/Finance Management/Invoice');

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
  const { search, status, payment_status, from_date, to_date, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = { company_id: req.user.company_id };
  if (status)         query.status         = status;
  if (payment_status) query.payment_status = payment_status;
  if (from_date || to_date) {
    query.invoice_date = {};
    if (from_date) query.invoice_date.$gte = new Date(from_date);
    if (to_date)   query.invoice_date.$lte = new Date(to_date);
  }
  if (search) {
    query.$or = [
      { invoice_no:     { $regex: search, $options: 'i' } },
      { customer_name:  { $regex: search, $options: 'i' } },
      { customer_phone: { $regex: search, $options: 'i' } },
      { quotation_no:   { $regex: search, $options: 'i' } },
      { order_no:       { $regex: search, $options: 'i' } },
    ];
  }

  const [total, invoices] = await Promise.all([
    Invoice.countDocuments(query),
    Invoice.find(query)
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(parseInt(limit))
      .lean(),
  ]);

  sendSuccess(res, {
    invoices,
    total,
    page: parseInt(page),
    limit: parseInt(limit),
    pages: Math.ceil(total / parseInt(limit)),
  });
}

// ── GET /api/invoices/:id ─────────────────────────────────────
async function getInvoice(req, res) {
  const invoice = await Invoice.findOne({
    _id: req.params.id,
    company_id: req.user.company_id,
  }).lean();
  if (!invoice) return sendError(res, 'Invoice not found.', 404);
  sendSuccess(res, invoice);
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
    amount:       parseFloat(amount),
    payment_date: payment_date || new Date(),
    payment_mode: payment_mode || 'Cash',
    reference_no: reference_no || '',
    note:         note         || '',
    received_by:  req.user._id,
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

module.exports = {
  listInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  updateInvoiceStatus,
  recordPayment,
  deleteInvoice,
  getInvoiceSummary,
};
