/**
 * Wholesaler Admin — Cross-company visibility (Super Admin only)
 *
 * Lets the Admin Dashboard read data across ALL companies:
 *   • orders, enquiries, users/staff, transactions
 * Mirrors the wholesalerAdminRoutes pattern (Super Admin guard + company name).
 */
const Order       = require('../../models/Marketplace Management/Order')
const Enquiry     = require('../../models/Marketplace Management/Enquiry')
const Company     = require('../../models/Company Management/Company')
const User        = require('../../models/User Management/User')
const Transaction = require('../../models/Finance Management/Transaction')
const Lead        = require('../../models/CRM Management/Lead')
const Followup    = require('../../models/CRM Management/Followup')
const Customer    = require('../../models/CRM Management/Customer')
const Dispatch    = require('../../models/Marketplace Management/Dispatch')
const Inventory   = require('../../models/Purchase & Inventory Management/Inventory')
const { sendSuccess, sendError, paginate } = require('../../utils/helpers')

function ensureSuperAdmin(req, res) {
  if (req.user.role !== 'Super Admin') {
    sendError(res, 'Access denied. Super Admin only.', 403)
    return false
  }
  return true
}

// Wholesaler companies are Company docs whose biz_type stems from "wholesale".
// `biz_type` is free text (entered at signup), so match the STEM case-
// insensitively — "Wholesaler", "Wholesalers", and the production typo
// "Wholesale" (no trailing r) all count. This mirrors RETAILER_FILTER on the
// retailer side.
const WHOLESALER_FILTER = { biz_type: /wholesale/i }

// Resolve the set of wholesaler company ids once per request. Every cross-
// company list below is scoped to these ids so the Wholesaler hub shows ONLY
// wholesaler data — and rows whose company_id is null/not-a-wholesaler (which
// used to render as a blank "—" company) are excluded.
async function wholesalerCompanyIds() {
  return Company.find(WHOLESALER_FILTER).distinct('_id')
}

function withCompany(rows) {
  return rows.map(r => ({
    ...r,
    company_name: r.company_id?.name || '—',
    company_code: r.company_id?.company_code || '',
    company_id:   r.company_id?._id || r.company_id,
  }))
}

// ── Enquiry reply roster helpers ─────────────────────────────
// A broadcast is N sibling Enquiry rows (one per recipient) sharing one
// `enq_code`; each recipient's row carries THAT recipient's answer. The admin
// view needs the whole roster — who answered with what, and who is still silent.
function enquiryHasReplied(row) {
  return ['Replied', 'Negotiation', 'Confirmed'].includes(row.status)
    || !!String(row.distributor_reply || '').trim()
    || row.offered_price != null
    || row.available_quantity != null
}

function shapeEnquiryReply(row, companyMap) {
  const c = row.company_id ? companyMap.get(String(row.company_id)) : null
  return {
    id: row._id,
    company: c ? {
      id: c._id,
      name: c.name || '',
      company_code: c.company_code || '',
    } : { id: null, name: row.retailer_name || '—', company_code: '' },
    status:             row.status,
    unit:               row.unit || '',
    qty:                row.qty,
    offered_price:      row.offered_price ?? null,
    available_quantity: row.available_quantity ?? null,
    delivery_timeline:  row.delivery_timeline || '',
    message:            row.distributor_reply || '',
    negotiation_note:   row.negotiation_note || '',
    remarks:            row.remarks || '',
    responded_at:       row.updated_at || null,
  }
}

// GET /api/wholesaler/all-orders
async function listAllOrders(req, res) {
  if (!ensureSuperAdmin(req, res)) return
  const { page = 1, limit = 50, status, search } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)
  const query = { company_id: { $in: await wholesalerCompanyIds() } }
  if (status && status !== 'All') query.status = status
  if (search) {
    query.$or = [
      { customer_name: { $regex: search, $options: 'i' } },
      { order_code:    { $regex: search, $options: 'i' } },
      { product_name:  { $regex: search, $options: 'i' } },
    ]
  }
  const [total, rows] = await Promise.all([
    Order.countDocuments(query),
    Order.find(query).populate('company_id', 'name company_code').sort({ created_at: -1 })
      .skip(offset).limit(parseInt(limit)).lean(),
  ])
  sendSuccess(res, { orders: withCompany(rows), pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

// GET /api/wholesaler/all-enquiries
//
// Groups broadcast siblings (N rows sharing one enq_code) into a single enquiry
// with a per-recipient status rollup and a reply roster, mirroring the retailer
// admin list. Legacy single-recipient enquiries (no enq_code) group by _id.
async function listAllEnquiries(req, res) {
  if (!ensureSuperAdmin(req, res)) return
  try {
    const { page = 1, limit = 200, status, search } = req.query
    const pageNum  = parseInt(page)
    const limitNum = parseInt(limit)
    const skip = (pageNum - 1) * limitNum

    const match = { company_id: { $in: await wholesalerCompanyIds() } }
    if (search) {
      match.$or = [
        { retailer_name: { $regex: search, $options: 'i' } },
        { product_name:  { $regex: search, $options: 'i' } },
        { enq_code:      { $regex: search, $options: 'i' } },
      ]
    }

    const groupKey = { $ifNull: ['$enq_code', { $toString: '$_id' }] }

    const pipeline = [
      { $match: match },
      { $sort: { created_at: -1 } },
      {
        $group: {
          _id: groupKey,
          anchor:         { $first: '$$ROOT' },
          recipients:     { $sum: 1 },
          statuses:       { $addToSet: '$status' },
          repliedCount:   { $sum: { $cond: [{ $in: ['$status', ['Replied', 'Negotiation', 'Confirmed']] }, 1, 0] } },
          viewedCount:    { $sum: { $cond: [{ $eq: ['$status', 'Viewed'] }, 1, 0] } },
          newCount:       { $sum: { $cond: [{ $eq: ['$status', 'New'] }, 1, 0] } },
          cancelledCount: { $sum: { $cond: [{ $eq: ['$status', 'Cancelled'] }, 1, 0] } },
          offeredPrices:  { $push: '$offered_price' },
          lastUpdated:    { $max: '$updated_at' },
          siblings:       { $push: '$$ROOT' },
        },
      },
    ]

    if (status && status !== 'All') {
      pipeline.push({ $match: { statuses: status } })
    }

    pipeline.push(
      { $sort: { 'anchor.created_at': -1 } },
      {
        $facet: {
          meta: [{ $count: 'total' }],
          data: [{ $skip: skip }, { $limit: limitNum }],
        },
      },
    )

    const [agg] = await Enquiry.aggregate(pipeline)
    const total  = agg?.meta?.[0]?.total || 0
    const groups = agg?.data || []

    // Resolve company names in one batch.
    const idsToResolve = new Set()
    groups.forEach(g => {
      if (g.anchor.company_id) idsToResolve.add(String(g.anchor.company_id))
      ;(g.siblings || []).forEach(s => {
        if (s.company_id) idsToResolve.add(String(s.company_id))
      })
    })
    const companies = await Company.find({ _id: { $in: [...idsToResolve] } })
      .select('name company_code').lean()
    const companyMap = new Map(companies.map(c => [String(c._id), c]))

    const enquiries = groups.map(g => {
      const r = g.anchor
      const co = r.company_id ? companyMap.get(String(r.company_id)) : null

      const prices = (g.offeredPrices || []).filter(p => p != null)
      const bestOffer = prices.length ? Math.min(...prices.map(Number)) : null

      const siblings = (g.siblings || [])
      const replied  = siblings.filter(enquiryHasReplied)
        .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))
        .map(s => shapeEnquiryReply(s, companyMap))
      const awaiting = siblings.filter(s => !enquiryHasReplied(s))
        .map(s => shapeEnquiryReply(s, companyMap))

      return {
        ...r,
        company_name: co?.name || '—',
        company_code: co?.company_code || '',
        company_id:   co?._id || r.company_id,
        recipient_count: g.recipients,
        status_rollup: {
          replied:   g.repliedCount,
          viewed:    g.viewedCount,
          new:       g.newCount,
          cancelled: g.cancelledCount,
          total:     g.recipients,
        },
        offered_price: bestOffer,
        updated_at:    g.lastUpdated || r.updated_at,
        replies: { replied, awaiting },
      }
    })

    sendSuccess(res, { enquiries, pagination: paginate(total, pageNum, limitNum) })
  } catch (e) {
    sendError(res, e.message, 500)
  }
}

// GET /api/wholesaler/all-users  — all staff/users across companies
async function listAllUsers(req, res) {
  if (!ensureSuperAdmin(req, res)) return
  const { page = 1, limit = 50, search, role } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)
  const query = { company_id: { $in: await wholesalerCompanyIds() } }
  if (role) query.role = role
  if (search) {
    query.$or = [
      { name:   { $regex: search, $options: 'i' } },
      { email:  { $regex: search, $options: 'i' } },
      { mobile: { $regex: search, $options: 'i' } },
    ]
  }
  const [total, rows] = await Promise.all([
    User.countDocuments(query),
    User.find(query).select('name email mobile role is_active company_id last_login created_at')
      .populate('company_id', 'name company_code').sort({ created_at: -1 })
      .skip(offset).limit(parseInt(limit)).lean(),
  ])
  sendSuccess(res, { users: withCompany(rows), pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

// GET /api/wholesaler/all-transactions  — sales/purchase/payment ledger across companies
async function listAllTransactions(req, res) {
  if (!ensureSuperAdmin(req, res)) return
  const { page = 1, limit = 50, type, search } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)
  const wsIds = await wholesalerCompanyIds()
  const query = { company_id: { $in: wsIds } }
  if (type) query.type = type
  if (search) {
    query.$or = [
      { party_name: { $regex: search, $options: 'i' } },
      { txn_code:   { $regex: search, $options: 'i' } },
      { reference:  { $regex: search, $options: 'i' } },
    ]
  }
  const [total, rows, agg] = await Promise.all([
    Transaction.countDocuments(query),
    Transaction.find(query).populate('company_id', 'name company_code').sort({ txn_date: -1 })
      .skip(offset).limit(parseInt(limit)).lean(),
    Transaction.aggregate([
      { $match: { company_id: { $in: wsIds } } },
      { $group: { _id: '$type', total: { $sum: '$amount' } } },
    ]),
  ])
  const totals = agg.reduce((acc, r) => ({ ...acc, [r._id]: r.total }), {})
  sendSuccess(res, {
    transactions: withCompany(rows),
    totals,   // { Received: n, Paid: n }
    pagination: paginate(total, parseInt(page), parseInt(limit)),
  })
}

// GET /api/wholesaler/all-leads  — CRM leads across all companies
async function listAllLeads(req, res) {
  if (!ensureSuperAdmin(req, res)) return
  const { page = 1, limit = 50, status, search } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)
  const query = { company_id: { $in: await wholesalerCompanyIds() } }
  if (status && status !== 'All') query.status = status
  if (search) {
    query.$or = [
      { name:   { $regex: search, $options: 'i' } },
      { mobile: { $regex: search, $options: 'i' } },
      { email:  { $regex: search, $options: 'i' } },
      { source: { $regex: search, $options: 'i' } },
    ]
  }
  const [total, rows] = await Promise.all([
    Lead.countDocuments(query),
    Lead.find(query).populate('company_id', 'name company_code').sort({ created_at: -1 })
      .skip(offset).limit(parseInt(limit)).lean(),
  ])
  sendSuccess(res, { leads: withCompany(rows), pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

// GET /api/wholesaler/all-followups  — CRM follow-ups across all companies
async function listAllFollowups(req, res) {
  if (!ensureSuperAdmin(req, res)) return
  const { page = 1, limit = 50, status, search } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)
  const query = { company_id: { $in: await wholesalerCompanyIds() } }
  if (status && status !== 'All') query.status = status
  if (search) {
    query.$or = [
      { notes: { $regex: search, $options: 'i' } },
    ]
  }
  const [total, rows] = await Promise.all([
    Followup.countDocuments(query),
    Followup.find(query)
      .populate('company_id', 'name company_code')
      .populate('lead_id', 'name mobile')
      .populate('customer_id', 'name mobile')
      .populate('assigned_to', 'name')
      .sort({ followup_date: -1 })
      .skip(offset).limit(parseInt(limit)).lean(),
  ])
  const mapped = withCompany(rows).map(r => ({
    ...r,
    lead_name:     r.lead_id?.name || '',
    customer_name: r.customer_id?.name || '',
    contact:       r.lead_id?.mobile || r.customer_id?.mobile || '',
    assigned_name: r.assigned_to?.name || '',
  }))
  sendSuccess(res, { followups: mapped, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

// GET /api/wholesaler/all-customers  — CRM customers across all companies
async function listAllCustomers(req, res) {
  if (!ensureSuperAdmin(req, res)) return
  const { page = 1, limit = 50, search } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)
  const query = { company_id: { $in: await wholesalerCompanyIds() } }
  if (search) {
    query.$or = [
      { name:       { $regex: search, $options: 'i' } },
      { mobile:     { $regex: search, $options: 'i' } },
      { email:      { $regex: search, $options: 'i' } },
      { gst_number: { $regex: search, $options: 'i' } },
      { city:       { $regex: search, $options: 'i' } },
    ]
  }
  const [total, rows] = await Promise.all([
    Customer.countDocuments(query),
    Customer.find(query).populate('company_id', 'name company_code').sort({ created_at: -1 })
      .skip(offset).limit(parseInt(limit)).lean(),
  ])
  sendSuccess(res, { customers: withCompany(rows), pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

module.exports = {
  listAllOrders, listAllEnquiries, listAllUsers, listAllTransactions,
  listAllLeads, listAllFollowups, listAllCustomers,
}
