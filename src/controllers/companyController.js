const bcrypt = require('bcryptjs')
const { sendSuccess, sendError, paginate } = require('../utils/helpers')
const { Company } = require('../models')

/** GET /api/companies  — Admin: list all */
async function listCompanies(req, res) {
  const { status, plan, page = 1, limit = 20 } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)

  const total = await Company.count({ status, plan })
  const companies = await Company.findAll({ status, plan, limit: parseInt(limit), offset })

  sendSuccess(res, { companies, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

/** GET /api/companies/:id */
async function getCompany(req, res) {
  const { id } = req.params
  const company = await Company.findById(id)
  if (!company) return sendError(res, 'Company not found.', 404)
  sendSuccess(res, company)
}

/** POST /api/companies  — Register new company */
async function createCompany(req, res) {
  const {
    name, owner_name, biz_type, mobile, email,
    gst_number, pan_number, address, city, state, pin_code, subscription_plan,
  } = req.body

  if (!name || !owner_name || !mobile || !email || !pan_number) {
    return sendError(res, 'Name, owner, mobile, email and PAN are required.')
  }

  const company_code = await Company.getNextCode()
  const company = await Company.create({
    company_code, name, owner_name, biz_type, mobile, email, gst_number, pan_number,
    address, city, state, pin_code, subscription_plan,
  })

  sendSuccess(res, company, 'Company registered. Awaiting admin approval.', 201)
}

/** PATCH /api/companies/:id/approve  — Super Admin */
async function approveCompany(req, res) {
  const { id } = req.params
  const company = await Company.approve(id, req.user.name)
  if (!company) return sendError(res, 'Company not found.', 404)
  sendSuccess(res, company, 'Company approved.')
}

/** PATCH /api/companies/:id/reject  — Super Admin */
async function rejectCompany(req, res) {
  const { reject_reason } = req.body
  const company = await Company.reject(req.params.id, reject_reason || '', req.user.name)
  if (!company) return sendError(res, 'Company not found.', 404)
  sendSuccess(res, company, 'Company rejected.')
}

/** PUT /api/companies/:id  — Edit company (admin or own) */
async function updateCompany(req, res) {
  const { id } = req.params
  const {
    name, owner_name, biz_type, mobile, email, gst_number,
    pan_number, address, city, state, pin_code, subscription_plan,
  } = req.body

  const company = await Company.update(id, {
    name, owner_name, biz_type, mobile, email, gst_number, pan_number,
    address, city, state, pin_code, subscription_plan,
  })
  if (!company) return sendError(res, 'Company not found.', 404)
  sendSuccess(res, company, 'Company updated.')
}

/** DELETE /api/companies/:id */
async function deleteCompany(req, res) {
  const deleted = await Company.delete(req.params.id)
  if (!deleted) return sendError(res, 'Company not found.', 404)
  sendSuccess(res, null, 'Company deleted.')
}

/** PATCH /api/companies/:id/docs  — Mark documents uploaded */
async function updateDocs(req, res) {
  const { docs_gst, docs_pan, docs_address, docs_biz } = req.body
  const company = await Company.updateDocs(req.params.id, { docs_gst, docs_pan, docs_address, docs_biz })
  if (!company) return sendError(res, 'Company not found.', 404)
  sendSuccess(res, company, 'Documents updated.')
}

module.exports = { listCompanies, getCompany, createCompany, approveCompany, rejectCompany, updateCompany, deleteCompany, updateDocs }
