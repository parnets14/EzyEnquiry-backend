/**
 * Wholesaler Quotation Controller
 *
 * Flow: wholesaler requests a product → admin quotes a price → wholesaler
 * accepts (creates an order/purchase) or rejects.
 *
 * Wholesaler endpoints (/api/wholesaler/quotations):
 *   POST  /              create a product request
 *   GET   /              list own requests
 *   GET   /:id           single request
 *   PATCH /:id/respond   accept (→ order) or reject a quoted request
 *
 * Admin endpoints (/api/wholesaler/all-quotations, Super Admin):
 *   GET   /              list all requests (all companies)
 *   PATCH /:id/quote     send a quotation (price) for a request
 */

const WholesalerQuotation = require('../../models/Wholesaler Management/WholesalerQuotation')
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

// ── WHOLESALER: POST /api/wholesaler/quotations ──────────────────────────────
async function createRequest(req, res) {
  const companyId = req.user.company_id
  if (!companyId) return sendError(res, 'No company linked to your account.', 400)

  const b = req.body
  if (!b.product_name || !String(b.product_name).trim()) return sendError(res, 'Product name is required.')

  const doc = await WholesalerQuotation.create({
    company_id:      companyId,
    request_no:      await nextCode(WholesalerQuotation, 'request_no', 'WQ'),
    product_id:      b.product_id || null,
    product_name:    String(b.product_name).trim(),
    product_code:    b.product_code || '',
    size:            b.size || '',
    finish:          b.finish || '',
    color:           b.color || '',
    unit:            b.unit || 'Sq Ft',
    requested_qty:   b.requested_qty != null && b.requested_qty !== '' ? parseFloat(b.requested_qty) : 0,
    wholesaler_note: b.wholesaler_note || b.notes || '',
    status:          'Requested',
    created_by:      req.user._id,
  })

  sendSuccess(res, doc, 'Request sent to admin for quotation.', 201)
}

// ── WHOLESALER: GET /api/wholesaler/quotations ───────────────────────────────
async function listMyRequests(req, res) {
  const { page = 1, limit = 30, status } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)
  const query = { company_id: req.user.company_id }
  if (status) query.status = status
  const [total, requests] = await Promise.all([
    WholesalerQuotation.countDocuments(query),
    WholesalerQuotation.find(query).sort({ created_at: -1 }).skip(offset).limit(parseInt(limit)).lean(),
  ])
  sendSuccess(res, { requests, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

// ── WHOLESALER: GET /api/wholesaler/quotations/:id ───────────────────────────
async function getRequest(req, res) {
  const doc = await WholesalerQuotation.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean()
  if (!doc) return sendError(res, 'Request not found.', 404)
  sendSuccess(res, doc)
}

// ── WHOLESALER: PATCH /api/wholesaler/quotations/:id/respond ─────────────────
// body: { action: 'accept' | 'reject' }
async function respondToQuote(req, res) {
  const { action } = req.body
  if (!['accept', 'reject'].includes(action)) return sendError(res, 'action must be accept or reject.')

  const doc = await WholesalerQuotation.findOne({ _id: req.params.id, company_id: req.user.company_id })
  if (!doc) return sendError(res, 'Request not found.', 404)
  if (doc.status !== 'Quoted') return sendError(res, `Cannot respond — request is "${doc.status}", not Quoted.`, 400)

  if (action === 'reject') {
    doc.status = 'Rejected'
    await doc.save()
    return sendSuccess(res, doc, 'Quotation rejected.')
  }

  // ── ACCEPT → create a Purchase (order) with stock-in, like a normal buy ──
  const qty  = doc.requested_qty > 0 ? doc.requested_qty : 1
  const rate = doc.quoted_price || 0
  const gst_percent  = doc.quoted_gst ?? 18
  const amount       = qty * rate
  const gst_amount   = Math.round(amount * gst_percent / 100)
  const total_amount = amount + gst_amount
  const companyId    = req.user.company_id

  const purchase = await Purchase.create({
    purchase_code: await nextCode(Purchase, 'purchase_code', 'PUR'),
    company_id:    companyId,
    supplier_name: 'Admin (Quotation)',
    product_id:    doc.product_id || null,
    product_code:  doc.product_code || '',
    product_name:  doc.product_name || '',
    qty, rate, amount, gst_percent, gst_amount, total_amount,
    purchase_date: new Date(),
    notes:         `From quotation ${doc.request_no}`,
    status:        'Received',
    stock_in_done: false,
    created_by:    req.user._id,
  })

  await Payable.create({
    pay_code:       await nextCode(Payable, 'pay_code', 'PAY'),
    company_id:     companyId,
    supplier_name:  'Admin (Quotation)',
    purchase_id:    purchase._id,
    invoice_amount: total_amount,
    paid:           0,
    outstanding:    total_amount,
    status:         'Pending',
  })

  if (purchase.product_id) {
    const claimed = await Purchase.findOneAndUpdate(
      { _id: purchase._id, stock_in_done: false },
      { $set: { stock_in_done: true } },
      { new: true }
    ).lean()
    if (claimed) {
      const invPrev = await Inventory.findOne({ company_id: companyId, product_id: purchase.product_id, warehouse_id: null }).select('current_stock').lean()
      const prevStock = invPrev?.current_stock || 0
      await Inventory.findOneAndUpdate(
        { company_id: companyId, product_id: purchase.product_id, warehouse_id: null },
        { $setOnInsert: { company_id: companyId }, $inc: { stock_in: qty, current_stock: qty, physical_stock: qty, available_stock: qty } },
        { upsert: true, new: true }
      )
      await StockMovement.create({
        company_id: companyId, movement_code: await nextCode(StockMovement, 'movement_code', 'MOV'),
        product_id: purchase.product_id, product_name: purchase.product_name || '', product_code: purchase.product_code || '',
        movement_type: 'Stock In', quantity: qty, previous_stock: prevStock, new_stock: prevStock + qty,
        reference_type: 'Purchase', reference_id: String(purchase._id), created_by: req.user._id, movement_date: new Date(),
      })
    }
  }

  doc.status = 'Ordered'
  doc.purchase_id = purchase._id
  await doc.save()

  sendSuccess(res, { request: doc, purchase }, 'Quotation accepted and order placed.')
}

// ── ADMIN: GET /api/wholesaler/all-quotations (Super Admin) ──────────────────
async function listAllRequests(req, res) {
  if (req.user.role !== 'Super Admin') return sendError(res, 'Access denied. Super Admin only.', 403)

  const { page = 1, limit = 50, status } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)
  const query = {}
  if (status) query.status = status

  const [total, requests] = await Promise.all([
    WholesalerQuotation.countDocuments(query),
    WholesalerQuotation.find(query)
      .populate('company_id', 'name company_code')
      .sort({ created_at: -1 })
      .skip(offset).limit(parseInt(limit)).lean(),
  ])

  const rows = requests.map(r => ({
    ...r,
    company_name: r.company_id?.name || '—',
    company_code: r.company_id?.company_code || '',
    company_id:   r.company_id?._id || r.company_id,
  }))
  sendSuccess(res, { requests: rows, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

// ── ADMIN: PATCH /api/wholesaler/all-quotations/:id/quote (Super Admin) ──────
// body: { quoted_price, quoted_gst?, admin_note? }
async function sendQuote(req, res) {
  if (req.user.role !== 'Super Admin') return sendError(res, 'Access denied. Super Admin only.', 403)

  const price = parseFloat(req.body.quoted_price)
  if (!price || price <= 0) return sendError(res, 'quoted_price must be greater than 0.')
  const gst = req.body.quoted_gst != null && req.body.quoted_gst !== '' ? parseFloat(req.body.quoted_gst) : 18

  const doc = await WholesalerQuotation.findById(req.params.id)
  if (!doc) return sendError(res, 'Request not found.', 404)
  if (['Accepted', 'Ordered'].includes(doc.status)) return sendError(res, `Cannot re-quote — already ${doc.status}.`, 400)

  const qty = doc.requested_qty > 0 ? doc.requested_qty : 1
  const amount = qty * price
  const quoted_total = amount + Math.round(amount * gst / 100)

  doc.quoted_price = price
  doc.quoted_gst   = gst
  doc.quoted_total = quoted_total
  doc.admin_note   = req.body.admin_note || ''
  doc.quoted_by    = req.user._id
  doc.quoted_at    = new Date()
  doc.status       = 'Quoted'
  await doc.save()

  sendSuccess(res, doc, 'Quotation sent to wholesaler.')
}

module.exports = {
  createRequest, listMyRequests, getRequest, respondToQuote,
  listAllRequests, sendQuote,
}
