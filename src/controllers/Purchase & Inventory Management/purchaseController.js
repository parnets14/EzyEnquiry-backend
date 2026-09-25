const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const Purchase      = require('../../models/Purchase & Inventory Management/Purchase');
const Inventory     = require('../../models/Purchase & Inventory Management/Inventory');
const Supplier      = require('../../models/Purchase & Inventory Management/Supplier');
const Payable       = require('../../models/Finance Management/Payable');
const Transaction   = require('../../models/Finance Management/Transaction');
const StockMovement = require('../../models/Purchase & Inventory Management/StockMovement');
const { checkAndNotifyStockLevels } = require('./inventoryController');

async function nextMovementCode() {
  const last = await StockMovement.findOne({ movement_code: /^MOV-/ }).sort({ movement_code: -1 }).lean();
  const num  = last?.movement_code ? parseInt(last.movement_code.split('-')[1], 10) : 0;
  return `MOV-${String(num + 1).padStart(4, '0')}`;
}

/** GET /api/purchases */
async function listPurchases(req, res) {
  const { search, supplier_id, status, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = { company_id: req.user.company_id };
  if (search) {
    query.$or = [
      { supplier_name: { $regex: search, $options: 'i' } },
      { product_name:  { $regex: search, $options: 'i' } },
      { purchase_code: { $regex: search, $options: 'i' } },
    ];
  }
  if (supplier_id) query.supplier_id = supplier_id;
  if (status)      query.status      = status;

  const [total, purchases] = await Promise.all([
    Purchase.countDocuments(query),
    Purchase.find(query).sort({ created_at: -1 }).skip(offset).limit(parseInt(limit)).lean(),
  ]);
  sendSuccess(res, { purchases, pagination: paginate(total, parseInt(page), parseInt(limit)) });
}

/** GET /api/purchases/:id */
async function getPurchase(req, res) {
  const purchase = await Purchase.findOne({ _id: req.params.id, company_id: req.user.company_id })
    .populate('supplier_id', 'name')
    .populate('product_id',  'name')
    .lean();
  if (!purchase) return sendError(res, 'Purchase not found.', 404);
  sendSuccess(res, purchase);
}

/** POST /api/purchases
 *
 * Supports two shapes:
 *   1. Single item  — legacy / simple: { supplier_name, qty, rate, … }
 *   2. Multi-item   — bill with many lines: { supplier_name, items: [{product_id, qty, rate, …}], … }
 *
 * Multi-item: all line items get the SAME bill_code; each becomes its own
 * Purchase record (keeps the Stock-In logic unchanged per-product).
 * The first item's purchase_code is returned as the canonical bill reference.
 *
 * auto_receive (bool, default false) — when true, immediately mark each
 * line status='Received' and stock_in_done=true, increment inventory,
 * write StockMovement, and fire back-in-stock/threshold notifications.
 * Use this when the goods have physically arrived at the warehouse before
 * the bill is entered (the common happy-path workflow from SOW).
 */
async function createPurchase(req, res) {
  const { supplier_name, items } = req.body;
  const auto_receive = Boolean(req.body.auto_receive);

  // ── Shared bill header fields ─────────────────────────
  const sharedFields = {
    supplier_id:     req.body.supplier_id     || null,
    supplier_name:   supplier_name            || '',
    warehouse_id:    req.body.warehouse_id    || null,
    warehouse_name:  req.body.warehouse_name  || '',
    branch_id:       req.body.branch_id       || null,
    branch_name:     req.body.branch_name     || '',
    invoice_number:  req.body.invoice_number  || '',
    delivery_number: req.body.delivery_number || '',
    purchase_date:   req.body.purchase_date   || null,
    due_date:        req.body.due_date        || null,
    notes:           req.body.notes           || '',
    payment_notes:   req.body.payment_notes   || '',
  };

  if (!supplier_name) return sendError(res, 'Supplier name is required.');

  // ── Normalise lines ─────────────────────────────────────
  // Accept either `items[]` (multi-item) or legacy top-level qty/rate fields.
  let lines;
  if (Array.isArray(items) && items.length > 0) {
    lines = items;
  } else {
    const { qty, rate } = req.body;
    if (!qty || !rate) return sendError(res, 'qty and rate are required (or use items[] for multi-product).');
    lines = [req.body];   // single-item — behaves exactly like before
  }

  // ── Generate a shared bill_code for this batch ──────────
  const lastBill = await Purchase.findOne({ bill_code: /^BILL-/ }).sort({ bill_code: -1 }).lean();
  const billNum  = lastBill?.bill_code ? parseInt(lastBill.bill_code.split('-')[1], 10) : 0;
  const bill_code = `BILL-${String(billNum + 1).padStart(4, '0')}`;

  const companyId = req.user.company_id;
  const createdPurchases = [];
  let billTotal = 0;

  for (const line of lines) {
    const gst_percent  = parseFloat(line.gst_percent || req.body.gst_percent || 18);
    const qty          = parseFloat(line.qty);
    const rate         = parseFloat(line.rate);
    if (!qty || !rate) continue;                          // skip invalid lines

    const amount       = qty * rate;
    const gst_amount   = Math.round(amount * gst_percent / 100);
    const total_amount = amount + gst_amount;
    billTotal += total_amount;

    // Per-item sequential purchase code
    const last = await Purchase.findOne({ purchase_code: /^PUR-/ }).sort({ purchase_code: -1 }).lean();
    const num  = last?.purchase_code ? parseInt(last.purchase_code.split('-')[1], 10) : 0;
    const purchase_code = `PUR-${String(num + 1).padStart(4, '0')}`;

    const initialStatus = auto_receive ? 'Received' : 'Pending';
    const purchase = await Purchase.create({
      ...sharedFields,
      bill_code,
      purchase_code,
      company_id: companyId,
      product_id:    line.product_id    || null,
      product_code:  line.product_code  || '',
      product_name:  line.product_name  || '',
      unit:          line.unit          || req.body.unit || '',
      qty, rate, amount, gst_percent, gst_amount, total_amount,
      payment_status: 'Due',
      status:         initialStatus,
      stock_in_done:  auto_receive ? true : false,
      created_by:     req.user._id,
    });

    // ── auto_receive: stock-in + movement log + threshold alerts ──────
    if (auto_receive && purchase.product_id && qty > 0) {
      const invFilter = { company_id: companyId, product_id: purchase.product_id, warehouse_id: sharedFields.warehouse_id || null };
      const invPrev = await Inventory.findOne(invFilter).select('current_stock available_stock physical_stock low_stock_alert').lean();
      const prevCurrent   = invPrev?.current_stock || 0;
      const prevAvailable = invPrev?.available_stock || 0;

      const newInv = await Inventory.findOneAndUpdate(
        invFilter,
        {
          $setOnInsert: { company_id: companyId },
          $inc: { stock_in: qty, current_stock: qty, physical_stock: qty, available_stock: qty },
        },
        { upsert: true, new: true }
      );

      await StockMovement.create({
        company_id:     companyId,
        movement_code:  await nextMovementCode(),
        product_id:     purchase.product_id,
        product_name:   purchase.product_name || '',
        product_code:   purchase.product_code || '',
        warehouse_id:   sharedFields.warehouse_id || null,
        warehouse_name: sharedFields.warehouse_name || '',
        movement_type:  'Stock In',
        quantity:       qty,
        previous_stock: prevCurrent,
        new_stock:      prevCurrent + qty,
        reference_type: 'Purchase',
        reference_id:   String(purchase._id),
        supplier_id:    sharedFields.supplier_id || null,
        supplier_name:  sharedFields.supplier_name || '',
        invoice_number: sharedFields.invoice_number || '',
        created_by:     req.user._id,
        movement_date:  new Date(),
      }).catch(e => console.error('[StockMovement] purchase auto log failed:', e.message));

      await checkAndNotifyStockLevels(
        companyId, purchase.product_id,
        prevAvailable, prevAvailable + qty,
        newInv?.low_stock_alert || null
      );
    }

    createdPurchases.push(purchase);
  }

  if (createdPurchases.length === 0) {
    return sendError(res, 'No valid line items — purchase not created.');
  }

  // ── Single Payable for the whole bill ─────────────────
  const lastPay = await Payable.findOne({ payable_code: /^PAY-/ }).sort({ payable_code: -1 }).lean();
  const pNum = lastPay?.payable_code ? parseInt(lastPay.payable_code.split('-')[1], 10) : 0;
  const payable = await Payable.create({
    payable_code:   `PAY-${String(pNum + 1).padStart(4, '0')}`,
    company_id:     companyId,
    supplier_id:    sharedFields.supplier_id,
    supplier_name:  sharedFields.supplier_name,
    purchase_id:    createdPurchases[0]._id,
    invoice_amount: billTotal,
    paid:           0,
    outstanding:    billTotal,
    status:         'Pending',
  });

  // ── Supplier ledger (Transaction) entry for the Payable ──
  // Credit the supplier's ledger with the bill amount.
  const lastTxn = await Transaction.findOne({ txn_code: /^TXN-/ }).sort({ txn_code: -1 }).lean();
  const tNum    = lastTxn?.txn_code ? parseInt(lastTxn.txn_code.split('-')[1], 10) : 0;
  await Transaction.create({
    txn_code:     `TXN-${String(tNum + 1).padStart(4, '0')}`,
    company_id:   companyId,
    type:         'Paid',   // money we WILL pay to the supplier (liability)
    party_name:   sharedFields.supplier_name,
    supplier_id:  sharedFields.supplier_id || null,
    reference_id: payable._id,
    amount:       billTotal,
    mode:         'Credit',
    reference:    `Purchase ${bill_code}`,
    notes:        `Purchase bill ${bill_code} — ${createdPurchases.length} line(s)`,
    txn_date:     new Date(),
    recorded_by:  req.user._id,
  }).catch(e => console.error('[Transaction] purchase ledger entry failed:', e.message));

  // Return the first record plus a summary for the UI.
  sendSuccess(res, {
    bill_code,
    auto_receive,
    items_created: createdPurchases.length,
    purchases: createdPurchases,
    first: createdPurchases[0],
  }, `Purchase bill ${bill_code} created with ${createdPurchases.length} item(s).`, 201);
}

/**
 * PATCH /api/purchases/:id/status
 * Transitions: Pending → Approved → Received → Completed | Cancelled
 * Stock-in only happens on → Received (idempotent via stock_in_done flag)
 */
async function updatePurchaseStatus(req, res) {
  const { status } = req.body;
  if (!status) return sendError(res, 'status is required.');

  const AUTHORISED_ROLES = ['Super Admin', 'Company Owner', 'Manager'];
  if (!AUTHORISED_ROLES.includes(req.user?.role)) {
    return sendError(res, 'Access denied. Only Admin/Manager can change purchase status.', 403);
  }

  const VALID_TRANSITIONS = {
    'Pending':   ['Approved', 'Cancelled'],
    'Approved':  ['Received', 'Cancelled'],
    'Received':  ['Completed'],
    'Completed': [],
    'Cancelled': [],
  };

  const purchase = await Purchase.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
  if (!purchase) return sendError(res, 'Purchase not found.', 404);

  const allowed = VALID_TRANSITIONS[purchase.status] || [];
  if (!allowed.includes(status)) {
    return sendError(res, `Invalid status transition: ${purchase.status} → ${status}. Allowed: ${allowed.join(', ') || 'none'}.`, 400);
  }

  await Purchase.findByIdAndUpdate(req.params.id, { status });

  // ── STOCK-IN: only when transitioning to 'Received' ──────
  if (status === 'Received' && purchase.product_id && !purchase.stock_in_done) {
    // A Super Admin has no company_id of their own — fall back to the
    // purchase's company so inventory always lands in the right place.
    const companyId = req.user.company_id || purchase.company_id;

    // Atomic idempotency: only update if stock_in_done is still false
    const claimed = await Purchase.findOneAndUpdate(
      { _id: req.params.id, company_id: companyId, stock_in_done: false },
      { $set: { stock_in_done: true } },
      { new: true }
    ).lean();

    if (claimed) {
      const qtyIn   = parseFloat(purchase.qty);
      const invFilter = { company_id: companyId, product_id: purchase.product_id, warehouse_id: purchase.warehouse_id || null };
      const invPrev = await Inventory.findOne(invFilter)
        .select('current_stock available_stock physical_stock low_stock_alert').lean();
      const prevStock     = invPrev?.current_stock   || 0;
      const prevAvailable = invPrev?.available_stock || 0;

      const newInv = await Inventory.findOneAndUpdate(
        invFilter,
        {
          $setOnInsert: { company_id: companyId },
          $inc: { stock_in: qtyIn, current_stock: qtyIn, physical_stock: qtyIn, available_stock: qtyIn },
        },
        { upsert: true, new: true }
      );

      // Audit row in the stock movement ledger (parity with dispatch stock-out).
      await StockMovement.create({
        company_id:     companyId,
        movement_code:  await nextMovementCode(),
        product_id:     purchase.product_id,
        product_name:   purchase.product_name || '',
        product_code:   purchase.product_code || '',
        warehouse_id:   purchase.warehouse_id || null,
        warehouse_name: purchase.warehouse_name || '',
        movement_type:  'Stock In',
        quantity:       qtyIn,
        previous_stock: prevStock,
        new_stock:      prevStock + qtyIn,
        reference_type: 'Purchase',
        reference_id:   String(purchase._id),
        supplier_id:    purchase.supplier_id || null,
        supplier_name:  purchase.supplier_name || '',
        invoice_number: purchase.invoice_number || '',
        created_by:     req.user._id,
        movement_date:  new Date(),
      }).catch(e => console.error('[StockMovement] purchase status log failed:', e.message));

      // Back-in-stock + low/out-of-stock threshold notifications
      await checkAndNotifyStockLevels(
        companyId, purchase.product_id,
        prevAvailable, prevAvailable + qtyIn,
        newInv?.low_stock_alert || null
      );
    }
  }

  const fresh = await Purchase.findById(req.params.id)
    .populate('supplier_id', 'name')
    .populate('product_id',  'name')
    .lean();
  sendSuccess(res, fresh, `Purchase status updated to ${status}.`);
}

/** PUT /api/purchases/:id */
async function updatePurchase(req, res) {
  const sanitised = { ...req.body };
  delete sanitised.status;
  delete sanitised.stock_in_done;

  const {
    supplier_name, product_name, qty, unit, rate, gst_percent = 18,
    invoice_number, delivery_number, purchase_date, notes, branch_id, branch_name,
    warehouse_id,
    // Payment fields
    payment_status, due_date, amount_paid, payment_notes,
  } = sanitised;

  const amount       = parseFloat(qty) * parseFloat(rate);
  const gst_amount   = Math.round(amount * gst_percent / 100);
  const total_amount = amount + gst_amount;

  // Derive payment_status automatically if amount_paid is provided.
  let derivedPaymentStatus = payment_status;
  if (amount_paid !== undefined) {
    const paid = parseFloat(amount_paid) || 0;
    if (paid <= 0)             derivedPaymentStatus = 'Due';
    else if (paid >= total_amount) derivedPaymentStatus = 'Paid';
    else                       derivedPaymentStatus = 'Partially Paid';
  }

  const purchase = await Purchase.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    {
      supplier_name, product_name, qty, unit, rate, amount, gst_percent, gst_amount, total_amount,
      invoice_number:  invoice_number  || '',
      delivery_number: delivery_number || '',
      purchase_date:   purchase_date   || null,
      notes:           notes           || '',
      ...(branch_id   !== undefined && { branch_id:   branch_id   || null }),
      ...(branch_name !== undefined && { branch_name: branch_name || '' }),
      ...(warehouse_id !== undefined && { warehouse_id: warehouse_id || null }),
      // Payment fields — only update if provided
      ...(derivedPaymentStatus !== undefined && { payment_status: derivedPaymentStatus }),
      ...(due_date    !== undefined && { due_date:   due_date   || null }),
      ...(amount_paid !== undefined && { amount_paid: parseFloat(amount_paid) || 0 }),
      ...(payment_notes !== undefined && { payment_notes: payment_notes || '' }),
    },
    { new: true }
  ).lean();
  if (!purchase) return sendError(res, 'Purchase not found.', 404);
  sendSuccess(res, purchase, 'Purchase updated.');
}

/** PATCH /api/purchases/:id/payment — record a payment against a purchase */
async function updatePayment(req, res) {
  const { amount_paid, payment_notes, due_date } = req.body;
  const purchase = await Purchase.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
  if (!purchase) return sendError(res, 'Purchase not found.', 404);

  const paid = parseFloat(amount_paid) || 0;
  const total = purchase.total_amount || 0;
  let payment_status = 'Due';
  if (paid >= total)  payment_status = 'Paid';
  else if (paid > 0)  payment_status = 'Partially Paid';

  // Check overdue — if due_date passed and not fully paid
  const dueDate = due_date ? new Date(due_date) : purchase.due_date;
  if (payment_status !== 'Paid' && dueDate && new Date() > dueDate) {
    payment_status = 'Overdue';
  }

  const updated = await Purchase.findByIdAndUpdate(
    req.params.id,
    { amount_paid: paid, payment_status, payment_notes: payment_notes || '', due_date: dueDate || null },
    { new: true }
  ).lean();
  sendSuccess(res, updated, `Payment recorded. Status: ${payment_status}.`);
}

/** DELETE /api/purchases/:id */
async function deletePurchase(req, res) {
  const purchase = await Purchase.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
  if (!purchase) return sendError(res, 'Purchase not found.', 404);

  // Reverse stock-in if it was done
  if (purchase.stock_in_done && purchase.product_id) {
    const qtyOut  = parseFloat(purchase.qty);
    const invPrev = await Inventory.findOne(
      { product_id: purchase.product_id, company_id: req.user.company_id, warehouse_id: purchase.warehouse_id || null }
    ).select('current_stock').lean();
    const prevStock = invPrev?.current_stock || 0;

    await Inventory.findOneAndUpdate(
      { product_id: purchase.product_id, company_id: req.user.company_id, warehouse_id: purchase.warehouse_id || null },
      { $inc: { stock_out: qtyOut, current_stock: -qtyOut, physical_stock: -qtyOut, available_stock: -qtyOut } }
    );

    await StockMovement.create({
      company_id:     req.user.company_id,
      movement_code:  await nextMovementCode(),
      product_id:     purchase.product_id,
      product_name:   purchase.product_name || '',
      product_code:   purchase.product_code || '',
      warehouse_id:   purchase.warehouse_id || null,
      warehouse_name: purchase.warehouse_name || '',
      movement_type:  'Reversal',
      quantity:       qtyOut,
      previous_stock: prevStock,
      new_stock:      prevStock - qtyOut,
      reference_type: 'Purchase',
      reference_id:   String(purchase._id),
      supplier_id:    purchase.supplier_id || null,
      supplier_name:  purchase.supplier_name || '',
      notes:          'Purchase deleted — stock-in reversed.',
      created_by:     req.user._id,
      movement_date:  new Date(),
    });
  }

  await Purchase.deleteOne({ _id: req.params.id, company_id: req.user.company_id });
  sendSuccess(res, null, 'Purchase deleted. Inventory reversed if stock had been received.');
}

// ── Suppliers ─────────────────────────────────────────────────

/** GET /api/purchases/suppliers/all */
async function listSuppliers(req, res) {
  const suppliers = await Supplier.find({ company_id: req.user.company_id }).sort({ name: 1 }).lean();
  sendSuccess(res, suppliers);
}

/** POST /api/purchases/suppliers */
async function createSupplier(req, res) {
  const { name } = req.body;
  if (!name) return sendError(res, 'Supplier name is required.');
  const supplier = await Supplier.create({
    company_id:  req.user.company_id,
    name,
    mobile:      req.body.mobile      || '',
    email:       req.body.email       || '',
    gst_number:  req.body.gst_number  || '',
    address:     req.body.address     || '',
    city:        req.body.city        || '',
    state:       req.body.state       || '',
    credit_days: req.body.credit_days || 30,
  });
  sendSuccess(res, supplier, 'Supplier created.', 201);
}

/** PUT /api/purchases/suppliers/:id */
async function updateSupplier(req, res) {
  const { name, mobile, email, gst_number, address, city, state, credit_days, is_active } = req.body;
  const supplier = await Supplier.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    { name, mobile, email, gst_number, address, city, state, credit_days, is_active: is_active !== false },
    { new: true }
  ).lean();
  if (!supplier) return sendError(res, 'Supplier not found.', 404);
  sendSuccess(res, supplier, 'Supplier updated.');
}

/** DELETE /api/purchases/suppliers/:id */
async function deleteSupplier(req, res) {
  const result = await Supplier.deleteOne({ _id: req.params.id, company_id: req.user.company_id });
  if (result.deletedCount === 0) return sendError(res, 'Supplier not found.', 404);
  sendSuccess(res, null, 'Supplier deleted.');
}

module.exports = {
  listPurchases, getPurchase, createPurchase, updatePurchase, deletePurchase,
  updatePurchaseStatus, updatePayment,
  listSuppliers, createSupplier, updateSupplier, deleteSupplier,
};
