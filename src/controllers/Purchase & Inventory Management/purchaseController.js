const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const Purchase     = require('../../models/Purchase & Inventory Management/Purchase');
const Inventory    = require('../../models/Purchase & Inventory Management/Inventory');
const Supplier     = require('../../models/Purchase & Inventory Management/Supplier');
const Payable      = require('../../models/Finance Management/Payable');

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

/** POST /api/purchases */
async function createPurchase(req, res) {
  const { supplier_name, qty, rate } = req.body;
  if (!supplier_name || !qty || !rate) return sendError(res, 'Supplier name, qty and rate are required.');

  const gst_percent  = parseFloat(req.body.gst_percent || 18);
  const amount       = parseFloat(qty) * parseFloat(rate);
  const gst_amount   = Math.round(amount * gst_percent / 100);
  const total_amount = amount + gst_amount;

  // Auto-generate purchase code
  const last = await Purchase.findOne({ purchase_code: /^PUR-/ }).sort({ purchase_code: -1 }).lean();
  const num  = last?.purchase_code ? parseInt(last.purchase_code.split('-')[1], 10) : 0;
  const purchase_code = `PUR-${String(num + 1).padStart(4, '0')}`;

  const purchase = await Purchase.create({
    ...req.body,
    purchase_code,
    company_id:  req.user.company_id,
    amount, gst_amount, total_amount, gst_percent,
    status:      'Pending',
    stock_in_done: false,
    created_by:  req.user._id,
  });

  // Auto create Payable
  const lastPay = await Payable.findOne({ payable_code: /^PAY-/ }).sort({ payable_code: -1 }).lean();
  const pNum = lastPay?.payable_code ? parseInt(lastPay.payable_code.split('-')[1], 10) : 0;
  await Payable.create({
    payable_code:   `PAY-${String(pNum + 1).padStart(4, '0')}`,
    company_id:     req.user.company_id,
    supplier_id:    req.body.supplier_id || null,
    supplier_name,
    purchase_id:    purchase._id,
    invoice_amount: total_amount,
    paid:           0,
    outstanding:    total_amount,
    status:         'Pending',
  });

  sendSuccess(res, purchase, 'Purchase created with status Pending. Approve → Receive to update inventory.', 201);
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
    // Atomic idempotency: only update if stock_in_done is still false
    const claimed = await Purchase.findOneAndUpdate(
      { _id: req.params.id, company_id: req.user.company_id, stock_in_done: false },
      { $set: { stock_in_done: true } },
      { new: true }
    ).lean();

    if (claimed) {
      await Inventory.findOneAndUpdate(
        { company_id: req.user.company_id, product_id: purchase.product_id, warehouse_id: purchase.warehouse_id || null },
        {
          $setOnInsert: { company_id: req.user.company_id },
          $inc: { stock_in: parseFloat(purchase.qty), current_stock: parseFloat(purchase.qty) },
        },
        { upsert: true, new: true }
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

  const { supplier_name, product_name, qty, rate, gst_percent = 18, invoice_number, delivery_number, purchase_date, notes, branch_id, branch_name, warehouse_id } = sanitised;
  const amount       = parseFloat(qty) * parseFloat(rate);
  const gst_amount   = Math.round(amount * gst_percent / 100);
  const total_amount = amount + gst_amount;

  const purchase = await Purchase.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    {
      supplier_name, product_name, qty, rate, amount, gst_percent, gst_amount, total_amount,
      invoice_number:  invoice_number  || '',
      delivery_number: delivery_number || '',
      purchase_date:   purchase_date   || null,
      notes:           notes           || '',
      ...(branch_id   !== undefined && { branch_id:   branch_id   || null }),
      ...(branch_name !== undefined && { branch_name: branch_name || '' }),
      ...(warehouse_id !== undefined && { warehouse_id: warehouse_id || null }),
    },
    { new: true }
  ).lean();
  if (!purchase) return sendError(res, 'Purchase not found.', 404);
  sendSuccess(res, purchase, 'Purchase updated.');
}

/** DELETE /api/purchases/:id */
async function deletePurchase(req, res) {
  const purchase = await Purchase.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
  if (!purchase) return sendError(res, 'Purchase not found.', 404);

  // Reverse stock-in if it was done
  if (purchase.stock_in_done && purchase.product_id) {
    await Inventory.findOneAndUpdate(
      { product_id: purchase.product_id, company_id: req.user.company_id, warehouse_id: purchase.warehouse_id || null },
      { $inc: { stock_out: parseFloat(purchase.qty), current_stock: -parseFloat(purchase.qty) } }
    );
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
  updatePurchaseStatus,
  listSuppliers, createSupplier, updateSupplier, deleteSupplier,
};
