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
const Order         = require('../../models/Marketplace Management/Order')
const Invoice       = require('../../models/Finance Management/Invoice')
const Company       = require('../../models/Company Management/Company')
const { sendSuccess, sendError, paginate } = require('../../utils/helpers')

// Build a compact "seller/company" block for invoice display + PDF.
function companyBlock(c) {
  if (!c) return null
  return {
    name:        c.name || '',
    owner_name:  c.owner_name || '',
    mobile:      c.mobile || '',
    email:       c.email || '',
    gst_number:  c.gst_number || '',
    address:     [c.address, c.city, c.state].filter(Boolean).join(', '),
    company_code: c.company_code || '',
  }
}

async function nextCode(Model, field, prefix) {
  const re = new RegExp('^' + prefix + '-')
  const last = await Model.findOne({ [field]: re }).sort({ [field]: -1 }).lean()
  const num = last?.[field] ? parseInt(String(last[field]).split('-')[1], 10) : 0
  return `${prefix}-${String(num + 1).padStart(4, '0')}`
}

// Order code helper: ORD-<year>-000001 (matches marketplace Order convention)
async function nextOrderCode() {
  const year = new Date().getFullYear()
  const re   = new RegExp('^ORD-' + year + '-')
  const last = await Order.findOne({ order_code: re }).sort({ order_code: -1 }).lean()
  const num  = last?.order_code ? parseInt(String(last.order_code).split('-')[2], 10) : 0
  return `ORD-${year}-${String(num + 1).padStart(6, '0')}`
}

// Invoice number helper: INV-0001 scoped to a company
async function nextInvoiceNo(companyId) {
  const last = await Invoice.findOne({ company_id: companyId, invoice_no: /^INV-/ })
    .sort({ created_at: -1 }).lean()
  const num = last?.invoice_no ? parseInt(String(last.invoice_no).split('-')[1], 10) : 0
  return `INV-${String(num + 1).padStart(4, '0')}`
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

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/wholesaler/all-purchases   (ADMIN — Super Admin only)
// Lists purchases from ALL companies (so the admin dashboard can see everything
// wholesalers bought/ordered), with the company name populated.
// ─────────────────────────────────────────────────────────────────────────────
async function listAllPurchases(req, res) {
  if (req.user.role !== 'Super Admin') {
    return sendError(res, 'Access denied. Super Admin only.', 403)
  }

  const { page = 1, limit = 50, search } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)

  const query = {}
  if (search) {
    query.$or = [
      { supplier_name: { $regex: search, $options: 'i' } },
      { product_name:  { $regex: search, $options: 'i' } },
      { purchase_code: { $regex: search, $options: 'i' } },
    ]
  }

  const [total, purchases] = await Promise.all([
    Purchase.countDocuments(query),
    Purchase.find(query)
      .populate('company_id', 'name company_code')
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(parseInt(limit))
      .lean(),
  ])

  // Flatten company info for easy display
  const rows = purchases.map(p => ({
    ...p,
    company_name: p.company_id?.name || '—',
    company_code: p.company_id?.company_code || '',
    company_id:   p.company_id?._id || p.company_id,
  }))

  sendSuccess(res, { purchases: rows, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/wholesaler/all-purchases/:id   (ADMIN — Super Admin only)
// Single wholesaler purchase-order from ANY company (with company name).
// ─────────────────────────────────────────────────────────────────────────────
async function getAdminPurchase(req, res) {
  if (req.user.role !== 'Super Admin') return sendError(res, 'Access denied. Super Admin only.', 403)

  const p = await Purchase.findById(req.params.id).populate('company_id', 'name company_code').lean()
  if (!p) return sendError(res, 'Purchase not found.', 404)

  sendSuccess(res, {
    ...p,
    company_name: p.company_id?.name || '—',
    company_code: p.company_id?.company_code || '',
    company_id:   p.company_id?._id || p.company_id,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/wholesaler/all-purchases/:id/approve   (ADMIN — Super Admin only)
// Approve a wholesaler purchase-order:
//   • Purchase.status → 'Approved'
//   • create an Order in Order Management (buyer = wholesaler company)
//   • generate an Invoice scoped to the wholesaler's company (visible in the app)
// ─────────────────────────────────────────────────────────────────────────────
async function approvePurchaseOrder(req, res) {
  if (req.user.role !== 'Super Admin') return sendError(res, 'Access denied. Super Admin only.', 403)

  const purchase = await Purchase.findById(req.params.id)
  if (!purchase) return sendError(res, 'Purchase not found.', 404)
  if (purchase.status === 'Approved')  return sendError(res, 'This order is already approved.', 400)
  if (purchase.status === 'Cancelled') return sendError(res, 'This order was rejected and cannot be approved.', 400)
  if (purchase.invoice_id)             return sendError(res, 'An invoice already exists for this order.', 400)

  const companyId    = purchase.company_id
  const qty          = purchase.qty || 1
  const rate         = purchase.rate || 0
  const gst_percent  = purchase.gst_percent ?? 18
  const amount       = purchase.amount || (qty * rate)
  const gst_amount   = purchase.gst_amount || Math.round(amount * gst_percent / 100)
  const total_amount = purchase.total_amount || (amount + gst_amount)

  // 1) Create the Order (Order Management) — buyer is the wholesaler's company
  const order = await Order.create({
    order_code:       await nextOrderCode(),
    company_id:       companyId,
    buyer_company_id: companyId,
    customer_name:    purchase.supplier_name || 'Wholesaler Order',
    product_id:       purchase.product_id || null,
    product_code:     purchase.product_code || '',
    product_name:     purchase.product_name || '',
    qty, rate, amount, gst_percent, gst_amount, total_amount,
    status:           'Invoice Generated',
    order_date:       new Date(),
    notes:            `Approved from wholesaler purchase ${purchase.purchase_code}`,
    status_history:   [{
      status: 'Approved', updated_by: req.user._id,
      updated_by_name: req.user.name || 'Admin', updated_by_role: req.user.role || '',
      remarks: `Auto-created from wholesaler purchase ${purchase.purchase_code}`,
    }],
    created_by:       req.user._id,
    created_by_name:  req.user.name || 'Admin',
  })

  // 2) Generate the Invoice — scoped to the wholesaler company so it shows in the app
  const invoice_no = await nextInvoiceNo(companyId)
  const invoice = await Invoice.create({
    company_id:    companyId,
    invoice_no,
    order_id:      order._id,
    order_no:      order.order_code,
    customer_name: purchase.supplier_name || 'Wholesaler',
    invoice_date:  new Date(),
    items: [{
      product_id:     purchase.product_id || null,
      product_name:   purchase.product_name || '',
      product_code:   purchase.product_code || '',
      unit:           'Sq Ft',
      gst_percent,
      qty,
      rate,
      taxable_amount: amount,
      gst_amount,
      total:          total_amount,
    }],
    subtotal:       amount,
    gst_amount,
    grand_total:    total_amount,
    paid_amount:    0,
    balance_due:    total_amount,
    payment_status: 'Unpaid',
    status:         'sent',
    remarks:        `Invoice for wholesaler purchase ${purchase.purchase_code}`,
    created_by:     req.user._id,
  })

  // 3) Mark the purchase approved + link order/invoice
  purchase.status         = 'Approved'
  purchase.order_id       = order._id
  purchase.invoice_id     = invoice._id
  purchase.invoice_number = invoice.invoice_no
  await purchase.save()

  sendSuccess(res, { purchase, order, invoice }, 'Order approved. Invoice generated.')
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/wholesaler/all-purchases/:id/reject   (ADMIN — Super Admin only)
// Reject a wholesaler purchase-order → Purchase.status = 'Cancelled'.
// ─────────────────────────────────────────────────────────────────────────────
async function rejectPurchaseOrder(req, res) {
  if (req.user.role !== 'Super Admin') return sendError(res, 'Access denied. Super Admin only.', 403)

  const purchase = await Purchase.findById(req.params.id)
  if (!purchase) return sendError(res, 'Purchase not found.', 404)
  if (purchase.status === 'Approved')  return sendError(res, 'This order is already approved and cannot be rejected.', 400)
  if (purchase.status === 'Cancelled') return sendError(res, 'This order is already rejected.', 400)

  purchase.status = 'Cancelled'
  if (req.body?.reason) purchase.notes = `${purchase.notes || ''} | Rejected: ${req.body.reason}`.trim()
  await purchase.save()

  sendSuccess(res, purchase, 'Order rejected.')
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/wholesaler/invoices   (WHOLESALER — own company)
// All invoices generated for the logged-in wholesaler's company (for the app).
// ─────────────────────────────────────────────────────────────────────────────
async function listMyInvoices(req, res) {
  const companyId = req.user.company_id
  if (!companyId) return sendError(res, 'No company linked to your account.', 400)

  const { page = 1, limit = 30, search } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)
  const query = { company_id: companyId }
  if (search) {
    query.$or = [
      { invoice_no: { $regex: search, $options: 'i' } },
      { order_no:   { $regex: search, $options: 'i' } },
    ]
  }
  const [total, invoices, company] = await Promise.all([
    Invoice.countDocuments(query),
    Invoice.find(query).sort({ created_at: -1 }).skip(offset).limit(parseInt(limit)).lean(),
    Company.findById(companyId).lean(),
  ])
  const block = companyBlock(company)
  const rows = invoices.map(inv => ({ ...inv, company: block }))
  sendSuccess(res, { invoices: rows, company: block, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

// GET /api/wholesaler/invoices/:id  (WHOLESALER — own company)
async function getMyInvoice(req, res) {
  const invoice = await Invoice.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean()
  if (!invoice) return sendError(res, 'Invoice not found.', 404)
  const company = await Company.findById(req.user.company_id).lean()
  sendSuccess(res, { ...invoice, company: companyBlock(company) })
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/wholesaler/all-purchases/:id   (ADMIN — Super Admin only)
// Delete a wholesaler purchase-order from ANY company. Blocked once approved
// (an approved order already spawned an Order + Invoice).
// ─────────────────────────────────────────────────────────────────────────────
async function deletePurchaseOrder(req, res) {
  if (req.user.role !== 'Super Admin') return sendError(res, 'Access denied. Super Admin only.', 403)

  const purchase = await Purchase.findById(req.params.id).lean()
  if (!purchase) return sendError(res, 'Purchase not found.', 404)
  if (purchase.status === 'Approved') {
    return sendError(res, 'Approved orders cannot be deleted (an invoice already exists). Reject is disabled too.', 400)
  }

  await Purchase.findByIdAndDelete(req.params.id)
  sendSuccess(res, { deleted: true }, 'Purchase order deleted.')
}

module.exports = {
  createPurchase, listPurchases, getPurchase, listAllPurchases,
  getAdminPurchase, approvePurchaseOrder, rejectPurchaseOrder, deletePurchaseOrder,
  listMyInvoices, getMyInvoice,
}
