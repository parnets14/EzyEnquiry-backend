/**
 * Wholesaler Admin — Cross-company visibility (Super Admin only)
 *
 * Lets the Admin Dashboard read data across ALL companies:
 *   • orders, enquiries, users/staff, transactions
 * Mirrors the wholesalerAdminRoutes pattern (Super Admin guard + company name).
 */
const Order       = require('../../models/Marketplace Management/Order')
const Enquiry     = require('../../models/Marketplace Management/Enquiry')
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

function withCompany(rows) {
  return rows.map(r => ({
    ...r,
    company_name: r.company_id?.name || '—',
    company_code: r.company_id?.company_code || '',
    company_id:   r.company_id?._id || r.company_id,
  }))
}

// GET /api/wholesaler/all-orders
async function listAllOrders(req, res) {
  if (!ensureSuperAdmin(req, res)) return
  const { page = 1, limit = 50, status, search } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)
  const query = {}
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
async function listAllEnquiries(req, res) {
  if (!ensureSuperAdmin(req, res)) return
  const { page = 1, limit = 50, status, search } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)
  const query = {}
  if (status && status !== 'All') query.status = status
  if (search) {
    query.$or = [
      { retailer_name: { $regex: search, $options: 'i' } },
      { product_name:  { $regex: search, $options: 'i' } },
      { enq_code:      { $regex: search, $options: 'i' } },
    ]
  }
  const [total, rows] = await Promise.all([
    Enquiry.countDocuments(query),
    Enquiry.find(query).populate('company_id', 'name company_code').sort({ created_at: -1 })
      .skip(offset).limit(parseInt(limit)).lean(),
  ])
  sendSuccess(res, { enquiries: withCompany(rows), pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

// GET /api/wholesaler/all-users  — all staff/users across companies
async function listAllUsers(req, res) {
  if (!ensureSuperAdmin(req, res)) return
  const { page = 1, limit = 50, search, role } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)
  const query = {}
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
  const query = {}
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
  const query = {}
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
  const query = {}
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
  const query = {}
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
