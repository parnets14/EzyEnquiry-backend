const { sendSuccess, sendError, paginate }          = require('../utils/helpers')
const { Customer, Lead, Followup, Notification }    = require('../models')

// ─────────────────────────────────────────────────────────────
// CUSTOMERS
// ─────────────────────────────────────────────────────────────

async function listCustomers(req, res) {
  const { search, page = 1, limit = 20 } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)

  const [total, customers] = await Promise.all([
    Customer.count(req.user.company_id, { search }),
    Customer.findAll(req.user.company_id, { search, limit: parseInt(limit), offset }),
  ])

  sendSuccess(res, { customers, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

async function getCustomer(req, res) {
  const customer = await Customer.findById(req.params.id, req.user.company_id)
  if (!customer) return sendError(res, 'Customer not found.', 404)

  // Order + enquiry history
  const { OrderModel }   = require('../models/Order')
  const { EnquiryModel } = require('../models/Enquiry')
  const mongoose = require('mongoose')

  const cust_id = new mongoose.Types.ObjectId(req.params.id)
  const [orders, enquiries] = await Promise.all([
    OrderModel.find({ customer_id: cust_id, company_id: req.user.company_id })
      .select('order_code product_name qty total_amount status created_at')
      .sort({ created_at: -1 }).limit(10).lean(),
    EnquiryModel.find({ company_id: req.user.company_id, retailer_mobile: customer.mobile })
      .select('enq_code product_name qty status created_at')
      .sort({ created_at: -1 }).limit(10).lean(),
  ])

  // outstanding from receivables
  const { ReceivableModel } = require('../models/Payment')
  const outstanding = await ReceivableModel.aggregate([
    { $match: { company_id: new mongoose.Types.ObjectId(req.user.company_id), customer_id: cust_id, status: { $ne: 'Received' } } },
    { $group: { _id: null, total: { $sum: '$outstanding' } } },
  ])

  sendSuccess(res, {
    ...customer,
    orders,
    enquiries,
    outstanding_amount: outstanding[0]?.total || 0,
  })
}

async function createCustomer(req, res) {
  const { name, mobile } = req.body
  if (!name || !mobile) return sendError(res, 'Name and mobile are required.')

  const customer = await Customer.create(req.user.company_id, req.body)
  sendSuccess(res, customer, 'Customer created.', 201)
}

async function updateCustomer(req, res) {
  const customer = await Customer.update(req.params.id, req.user.company_id, req.body)
  if (!customer) return sendError(res, 'Customer not found.', 404)
  sendSuccess(res, customer, 'Customer updated.')
}

async function deleteCustomer(req, res) {
  const deleted = await Customer.delete(req.params.id, req.user.company_id)
  if (!deleted) return sendError(res, 'Customer not found.', 404)
  sendSuccess(res, null, 'Customer deleted.')
}

// ─────────────────────────────────────────────────────────────
// LEADS
// ─────────────────────────────────────────────────────────────

async function listLeads(req, res) {
  const { status, source, page = 1, limit = 20 } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)

  const [total, leads] = await Promise.all([
    Lead.count(req.user.company_id, { status, source }),
    Lead.findAll(req.user.company_id, { status, source, limit: parseInt(limit), offset }),
  ])

  sendSuccess(res, { leads, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

async function createLead(req, res) {
  const { name, mobile } = req.body
  if (!name || !mobile) return sendError(res, 'Name and mobile are required.')

  const lead = await Lead.create(req.user.company_id, req.body)
  sendSuccess(res, lead, 'Lead created.', 201)
}

async function updateLead(req, res) {
  const lead = await Lead.update(req.params.id, req.user.company_id, req.body)
  if (!lead) return sendError(res, 'Lead not found.', 404)
  sendSuccess(res, lead, 'Lead updated.')
}

async function convertLead(req, res) {
  const lead = await Lead.findById(req.params.id, req.user.company_id)
  if (!lead) return sendError(res, 'Lead not found.', 404)
  if (lead.status === 'Converted') return sendError(res, 'Lead already converted.')

  const customer = await Customer.create(req.user.company_id, {
    name:     lead.name,
    mobile:   lead.mobile,
    email:    lead.email || '',
    biz_type: 'Retailer',
  })

  const updatedLead = await Lead.markConverted(lead._id, customer._id)

  sendSuccess(res, { lead: updatedLead, customer }, 'Lead converted to customer.')
}

async function deleteLead(req, res) {
  const deleted = await Lead.delete(req.params.id, req.user.company_id)
  if (!deleted) return sendError(res, 'Lead not found.', 404)
  sendSuccess(res, null, 'Lead deleted.')
}

// ─────────────────────────────────────────────────────────────
// FOLLOW-UPS
// ─────────────────────────────────────────────────────────────

async function listFollowups(req, res) {
  const { status, lead_id, customer_id, page = 1, limit = 20 } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)

  const [total, followups] = await Promise.all([
    Followup.count(req.user.company_id, { status, lead_id, customer_id }),
    Followup.findAll(req.user.company_id, { status, lead_id, customer_id, limit: parseInt(limit), offset }),
  ])

  sendSuccess(res, { followups, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

async function createFollowup(req, res) {
  const { followup_date } = req.body
  if (!followup_date) return sendError(res, 'followup_date is required.')

  const followup = await Followup.create(req.user.company_id, req.body)
  sendSuccess(res, followup, 'Follow-up scheduled.', 201)
}

async function updateFollowup(req, res) {
  const followup = await Followup.update(req.params.id, req.user.company_id, req.body)
  if (!followup) return sendError(res, 'Follow-up not found.', 404)
  sendSuccess(res, followup, 'Follow-up updated.')
}

async function deleteFollowup(req, res) {
  const deleted = await Followup.delete(req.params.id, req.user.company_id)
  if (!deleted) return sendError(res, 'Follow-up not found.', 404)
  sendSuccess(res, null, 'Follow-up deleted.')
}

module.exports = {
  listCustomers, getCustomer, createCustomer, updateCustomer, deleteCustomer,
  listLeads, createLead, updateLead, convertLead, deleteLead,
  listFollowups, createFollowup, updateFollowup, deleteFollowup,
}
