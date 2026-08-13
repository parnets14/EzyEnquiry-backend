const { QuotationModel, getNextQuotationNo } = require('../models/Quotation')
const { sendSuccess, sendError } = require('../utils/helpers')

// ── List ──────────────────────────────────────────────────────
async function listQuotations(req, res) {
  const { search, status, page = 1, limit = 200 } = req.query
  const cid    = req.user.company_id
  const skip   = (parseInt(page) - 1) * parseInt(limit)
  const query  = { company_id: cid }

  if (status) query.status = status
  if (search) {
    query.$or = [
      { quotation_no:   { $regex: search, $options: 'i' } },
      { customer_name:  { $regex: search, $options: 'i' } },
      { customer_phone: { $regex: search, $options: 'i' } },
      { enquiry_no:     { $regex: search, $options: 'i' } },
    ]
  }

  const [total, quotations] = await Promise.all([
    QuotationModel.countDocuments(query),
    QuotationModel.find(query)
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean(),
  ])

  sendSuccess(res, { quotations, total, page: parseInt(page), limit: parseInt(limit) })
}

// ── Get one ───────────────────────────────────────────────────
async function getQuotation(req, res) {
  const q = await QuotationModel.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean()
  if (!q) return sendError(res, 'Quotation not found', 404)
  sendSuccess(res, q)
}

// ── Create ────────────────────────────────────────────────────
async function createQuotation(req, res) {
  const cid  = req.user.company_id
  const body = req.body

  // Use provided quotation_no or auto-generate
  const quotation_no = (body.quotation_no || '').trim() || await getNextQuotationNo(cid)

  const q = await QuotationModel.create({
    company_id:      cid,
    quotation_no,
    enquiry_id:      body.enquiry_id      || null,
    enquiry_no:      body.enquiry_no      || '',
    delivery_no:     body.delivery_no     || '',
    customer_name:   body.customer_name   || '',
    customer_phone:  body.customer_phone  || '',
    customer_email:  body.customer_email  || '',
    quotation_date:  body.quotation_date  || new Date(),
    valid_until:     body.valid_until     || null,
    items:           Array.isArray(body.items) ? body.items : [],
    freight_charges: parseFloat(body.freight_charges) || 0,
    other_charges:   parseFloat(body.other_charges)   || 0,
    subtotal:        parseFloat(body.subtotal)         || 0,
    gst_amount:      parseFloat(body.gst_amount)       || 0,
    grand_total:     parseFloat(body.grand_total)      || 0,
    remarks:         body.remarks  || '',
    terms:           body.terms    || '',
    status:          'draft',
    created_by:      req.user._id,
  })

  sendSuccess(res, q, 'Quotation created successfully', 201)
}

// ── Update ────────────────────────────────────────────────────
async function updateQuotation(req, res) {
  const body = req.body
  const updates = {
    quotation_no:    body.quotation_no    || undefined,
    enquiry_id:      body.enquiry_id      || null,
    enquiry_no:      body.enquiry_no      ?? undefined,
    delivery_no:     body.delivery_no     ?? undefined,
    customer_name:   body.customer_name   ?? undefined,
    customer_phone:  body.customer_phone  ?? undefined,
    customer_email:  body.customer_email  ?? undefined,
    quotation_date:  body.quotation_date  ?? undefined,
    valid_until:     body.valid_until     ?? undefined,
    items:           Array.isArray(body.items) ? body.items : undefined,
    freight_charges: body.freight_charges != null ? parseFloat(body.freight_charges) : undefined,
    other_charges:   body.other_charges   != null ? parseFloat(body.other_charges)   : undefined,
    subtotal:        body.subtotal        != null ? parseFloat(body.subtotal)         : undefined,
    gst_amount:      body.gst_amount      != null ? parseFloat(body.gst_amount)       : undefined,
    grand_total:     body.grand_total     != null ? parseFloat(body.grand_total)      : undefined,
    remarks:         body.remarks         ?? undefined,
    terms:           body.terms           ?? undefined,
  }
  // Remove undefined keys
  Object.keys(updates).forEach(k => updates[k] === undefined && delete updates[k])

  const q = await QuotationModel.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    updates,
    { new: true }
  ).lean()

  if (!q) return sendError(res, 'Quotation not found', 404)
  sendSuccess(res, q, 'Quotation updated')
}

// ── Update Status ─────────────────────────────────────────────
async function updateQuotationStatus(req, res) {
  const { status } = req.body
  const VALID = ['draft','sent','accepted','converted','expired','cancelled']
  if (!VALID.includes(status)) return sendError(res, 'Invalid status', 400)

  const q = await QuotationModel.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    { status },
    { new: true }
  ).lean()

  if (!q) return sendError(res, 'Quotation not found', 404)
  sendSuccess(res, q, `Status updated to ${status}`)
}

// ── Delete ────────────────────────────────────────────────────
async function deleteQuotation(req, res) {
  const q = await QuotationModel.findOneAndDelete({
    _id: req.params.id, company_id: req.user.company_id,
  }).lean()
  if (!q) return sendError(res, 'Quotation not found', 404)
  sendSuccess(res, null, 'Quotation deleted')
}

module.exports = {
  listQuotations, getQuotation, createQuotation,
  updateQuotation, updateQuotationStatus, deleteQuotation,
}
