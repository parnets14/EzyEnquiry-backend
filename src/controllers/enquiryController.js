const { sendSuccess, sendError, paginate }    = require('../utils/helpers')
const { Enquiry, Notification }               = require('../models')

// ── Role sets ────────────────────────────────────────────────
// Who can CREATE an enquiry (raise a product request)
const ENQUIRY_CREATOR_ROLES = ['Retailer', 'Sales Executive', 'Manager', 'Company Owner', 'Super Admin']
// Who can REPLY / change status on an enquiry (wholesaler-side actions)
const ENQUIRY_REPLY_ROLES   = ['Wholesaler', 'Manager', 'Company Owner', 'Super Admin']
// Who sees ALL enquiries vs only their own
const SEE_ALL_ROLES         = ['Wholesaler', 'Manager', 'Accountant', 'Company Owner', 'Super Admin', 'Warehouse Staff', 'Sales Executive']

/** GET /api/enquiries */
async function listEnquiries(req, res) {
  const { status, search, page = 1, limit = 20 } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)

  // Retailer only sees their own enquiries
  const createdByFilter = SEE_ALL_ROLES.includes(req.user?.role) ? null : req.user._id

  const [total, enquiries] = await Promise.all([
    Enquiry.count(req.user.company_id, { status, search, created_by: createdByFilter }),
    Enquiry.findAll(req.user.company_id, { status, search, limit: parseInt(limit), offset, created_by: createdByFilter }),
  ])

  sendSuccess(res, { enquiries, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

/** GET /api/enquiries/stats */
async function enquiryStats(req, res) {
  const stats = await Enquiry.getStatusStats(req.user.company_id)
  sendSuccess(res, stats)
}

/** GET /api/enquiries/:id */
async function getEnquiry(req, res) {
  const enq = await Enquiry.findById(req.params.id, req.user.company_id)
  if (!enq) return sendError(res, 'Enquiry not found.', 404)
  sendSuccess(res, enq)
}

/** POST /api/enquiries */
async function createEnquiry(req, res) {
  // Only retailers / sales staff / managers can raise enquiries
  if (!ENQUIRY_CREATOR_ROLES.includes(req.user?.role)) {
    return sendError(res, 'Only Retailers and Sales staff can create enquiries.', 403)
  }

  const { retailer_name, retailer_mobile, qty } = req.body
  if (!retailer_name || !retailer_mobile || !qty) {
    return sendError(res, 'Retailer name, mobile and qty are required.')
  }

  const enq = await Enquiry.create({
    ...req.body,
    company_id: req.user.company_id,
    created_by: req.user._id,
  })

  await Notification.create(req.user.company_id, {
    type:         'enquiry',
    title:        `New Enquiry — ${enq.enq_code}`,
    message:      `New enquiry from ${retailer_name} for ${req.body.product_name || '—'} × ${qty} ${req.body.unit || 'Sq Ft'}`,
    reference_id: enq._id,
  })

  sendSuccess(res, enq, 'Enquiry created.', 201)
}

/** PATCH /api/enquiries/:id */
async function updateEnquiry(req, res) {
  const REPLY_STATUSES = ['Viewed', 'Replied', 'Negotiation', 'Confirmed', 'Cancelled']

  // If caller is changing status to a wholesaler-action status, enforce role
  if (req.body.status && REPLY_STATUSES.includes(req.body.status)) {
    if (!ENQUIRY_REPLY_ROLES.includes(req.user?.role)) {
      return sendError(res, 'Only Wholesalers and Managers can update enquiry status.', 403)
    }
  }

  // Retailer can only update remarks on their own enquiry — not change status
  if (req.user?.role === 'Retailer' && req.body.status) {
    return sendError(res, 'Retailers cannot change enquiry status.', 403)
  }

  const enq = await Enquiry.update(req.params.id, req.user.company_id, req.body)
  if (!enq) return sendError(res, 'Enquiry not found.', 404)
  sendSuccess(res, enq, 'Enquiry updated.')
}

/** DELETE /api/enquiries/:id */
async function deleteEnquiry(req, res) {
  const deleted = await Enquiry.delete(req.params.id, req.user.company_id)
  if (!deleted) return sendError(res, 'Enquiry not found.', 404)
  sendSuccess(res, null, 'Enquiry deleted.')
}

module.exports = { listEnquiries, enquiryStats, getEnquiry, createEnquiry, updateEnquiry, deleteEnquiry }
