/**
 * Wholesaler Purchase Controller
 *
 * Lets a wholesaler BUY / purchase items into their own inventory.
 * Scoped to the wholesaler's company_id (from the auth token).
 *
 * On create:
 *   • computes amount / GST / total  (amount = qty * rate)
 *   • creates the Purchase (status 'Received' — goods bought in)
 *   • creates a Payable (supplier outstanding)
 *   • increments Inventory and writes a StockMovement (Stock In)
 *
 * Endpoints (mounted at /api/wholesaler/purchases, all require auth):
 *   POST /            create purchase
 *   GET  /            list purchases
 *   GET  /:id         single purchase
 */

const Purchase      = require('../../models/Purchase & Inventory Management/Purchase')
const Inventory     = require('../../models/Purchase & Inventory Management/Inventory')
const Payable       = require('../../models/Finance Management/Payable')
const StockMovement = require('../../models/Purchase & Inventory Management/StockMovement')
const { sendSuccess, sendError, paginate } = require('../../utils/helpers')

async function nextCode(Model, field, prefix) {
  const re = new RegExp('^' + prefix + '-')
  const last = await Model.findOne({ [field]: re }).sort({ [field]: -1 }).lean()
  const num = last?.[field] ? parseInt(String(last[field]).split('-')[1], 10) : 0
  return `${prefix}-${String(num + 1).padStart(4, '0')}`
}

// POST /api/wholesaler/purchases
async function createPurchase(req, res) {
  const companyId = req.user.company_id
  if (!companyId) return sendError(res, 'No company linked to your account.', 400)

  const b = req.body
  if (!b.supplier_name || !String(b.supplier_name).trim()) return sendError(res, 'Supplier name is required.')
  const qty  = parseFloat(b.qty)
  const rate = parseFloat(b.rate)
  if (!qty || qty <= 0)  return sendError(res, 'Quantity must be greater than 0.')
  if (!rate || rate <= 0) return sendError(res, 'Rate must be greater than 0.')

  const gst_percent  = b.gst_percent != null && b.gst_percent !== '' ? parseFloat(b.gst_percent) : 18
  const amount       = qty * rate
  const gst_amount   = Math.round(amount * gst_percent / 100)
  const total_amount = amount + gst_amount

  const purchase = await Purchase.create({
    purchase_code: await nextCode(Purchase, 'purchase_code', 'PUR'),
    company_id:    companyId,
    supplier_id:   b.supplier_id || null,
    supplier_name: String(b.supplier_name).trim(),
    product_id:    b.product_id || null,
    product_code:  b.product_code || '',
    product_name:  b.product_name || '',
    qty, rate, amount, gst_percent, gst_amount, total_amount,
    warehouse_id:  b.warehouse_id || null,
    invoice_number: b.invoice_number || '',
    purchase_date:  b.purchase_date || new Date(),
    notes:          b.notes || '',
    status:         'Received',   // wholesaler bought it in
    stock_in_done:  false,
    created_by:     req.user._id,
  })

  // Supplier payable
  await Payable.create({
    pay_code:       await nextCode(Payable, 'pay_code', 'PAY'),
    company_id:     companyId,
    supplier_id:    b.supplier_id || null,
    supplier_name:  String(b.supplier_name).trim(),
    purchase_id:    purchase._id,
    invoice_amount: total_amount,
    paid:           0,
    outstanding:    total_amount,
    status:         'Pending',
  })

  // Stock-in into inventory (+ movement ledger) if a product is linked
  if (purchase.product_id) {
    const claimed = await Purchase.findOneAndUpdate(
      { _id: purchase._id, stock_in_done: false },
      { $set: { stock_in_done: true } },
      { new: true }
    ).lean()

    if (claimed) {
      const invPrev = await Inventory.findOne({
        company_id: companyId, product_id: purchase.product_id, warehouse_id: purchase.warehouse_id || null,
      }).select('current_stock').lean()
      const prevStock = invPrev?.current_stock || 0

      await Inventory.findOneAndUpdate(
        { company_id: companyId, product_id: purchase.product_id, warehouse_id: purchase.warehouse_id || null },
        {
          $setOnInsert: { company_id: companyId },
          $inc: { stock_in: qty, current_stock: qty, physical_stock: qty, available_stock: qty },
        },
        { upsert: true, new: true }
      )

      await StockMovement.create({
        company_id:     companyId,
        movement_code:  await nextCode(StockMovement, 'movement_code', 'MOV'),
        product_id:     purchase.product_id,
        product_name:   purchase.product_name || '',
        product_code:   purchase.product_code || '',
        warehouse_id:   purchase.warehouse_id || null,
        movement_type:  'Stock In',
        quantity:       qty,
        previous_stock: prevStock,
        new_stock:      prevStock + qty,
        reference_type: 'Purchase',
        reference_id:   String(purchase._id),
        supplier_id:    purchase.supplier_id || null,
        supplier_name:  purchase.supplier_name || '',
        invoice_number: purchase.invoice_number || '',
        created_by:     req.user._id,
        movement_date:  new Date(),
      })
    }
  }

  const fresh = await Purchase.findById(purchase._id).lean()
  sendSuccess(res, fresh, 'Purchase recorded and stock added.', 201)
}

// GET /api/wholesaler/purchases
async function listPurchases(req, res) {
  const { page = 1, limit = 20, search } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)
  const query = { company_id: req.user.company_id }
  if (search) {
    query.$or = [
      { supplier_name: { $regex: search, $options: 'i' } },
      { product_name:  { $regex: search, $options: 'i' } },
      { purchase_code: { $regex: search, $options: 'i' } },
    ]
  }
  const [total, purchases] = await Promise.all([
    Purchase.countDocuments(query),
    Purchase.find(query).sort({ created_at: -1 }).skip(offset).limit(parseInt(limit)).lean(),
  ])
  sendSuccess(res, { purchases, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

// GET /api/wholesaler/purchases/:id
async function getPurchase(req, res) {
  const purchase = await Purchase.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean()
  if (!purchase) return sendError(res, 'Purchase not found.', 404)
  sendSuccess(res, purchase)
}

module.exports = { createPurchase, listPurchases, getPurchase }
