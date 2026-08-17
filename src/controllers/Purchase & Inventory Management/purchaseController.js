const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const Purchase  = require('../../models/Purchase & Inventory Management/Purchase');
const Inventory = require('../../models/Purchase & Inventory Management/Inventory');
const Payable   = require('../../models/Finance Management/Payable');

// ── Helper: generate next purchase code ──────────────────────
async function getNextPurchaseCode() {
  const last = await Purchase.findOne({ purchase_code: /^PUR-/ }).sort({ purchase_code: -1 }).lean();
  if (!last?.purchase_code) return 'PUR-0001';
  const num = parseInt(last.purchase_code.split('-')[1], 10);
  return `PUR-${String(num + 1).padStart(4, '0')}`;
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
    .populate('product_id', 'name')
    .lean();
  if (!purchase) return sendError(res, 'Purchase not found.', 404);
  sendSuccess(res, purchase);
}

/** POST /api/purchases */
async function createPurchase(req, res) {
  const { supplier_name, qty, rate, product_id, warehouse_id, supplier_id } = req.body;
  if (!supplier_name || !qty || !rate) return sendError(res, 'Supplier name, qty and rate are required.');

  const gst_percent  = parseFloat(req.body.gst_percent || 18);
  const amount       = parseFloat(qty) * parseFloat(rate);
  const gst_amount   = Math.round(amount * gst_percent / 100);
  const total_amount = amount + gst_amount;
  const purchase_code = await getNextPurchaseCode();

  const purchase = await Purchase.create({
    ...req.body,
    purchase_code,
    company_id:  req.user.company_id,
    amount, gst_amount, total_amount, gst_percent,
    created_by:  req.user._id,
  });

  // Auto stock-in
  if (product_id) {
    await Inventory.findOneAndUpdate(
      { company_id: req.user.company_id, product_id, warehouse_id: warehouse_id || null },
      {
        $setOnInsert: { company_id: req.user.company_id },
        $inc: { stock_in: parseFloat(qty), current_stock: parseFloat(qty) },
      },
      { upsert: true, new: true }
    );
  }

  // Auto create payable
  await Payment.create({
    company_id:     req.user.company_id,
    type:           'Payable',
    supplier_id:    supplier_id || null,
    supplier_name,
    purchase_id:    purchase._id,
    invoice_amount: total_amount,
    paid_amount:    0,
    balance:        total_amount,
    status:         'Pending',
  });

  sendSuccess(res, purchase, 'Purchase created. Inventory & payable auto-updated.', 201);
}

/** PUT /api/purchases/:id */
async function updatePurchase(req, res) {
  const { supplier_name, product_name, qty, rate, gst_percent = 18, invoice_number, delivery_number, purchase_date, status, notes, stock_in_done } = req.body;
  const amount       = parseFloat(qty) * parseFloat(rate);
  const gst_amount   = Math.round(amount * gst_percent / 100);
  const total_amount = amount + gst_amount;

  const update = {
    supplier_name, product_name, qty, rate,
    amount, gst_percent, gst_amount, total_amount,
    invoice_number:  invoice_number  || '',
    delivery_number: delivery_number || '',
    purchase_date:   purchase_date   || null,
    status, notes,
  };
  if (stock_in_done !== undefined) update.stock_in_done = stock_in_done;

  const purchase = await Purchase.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    update,
    { new: true }
  ).lean();
  if (!purchase) return sendError(res, 'Purchase not found.', 404);
  sendSuccess(res, purchase, 'Purchase updated.');
}

/** DELETE /api/purchases/:id */
async function deletePurchase(req, res) {
  const result = await Purchase.deleteOne({ _id: req.params.id, company_id: req.user.company_id });
  if (result.deletedCount === 0) return sendError(res, 'Purchase not found.', 404);
  sendSuccess(res, null, 'Purchase deleted.');
}

module.exports = { listPurchases, getPurchase, createPurchase, updatePurchase, deletePurchase };
