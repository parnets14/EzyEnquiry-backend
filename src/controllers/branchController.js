const { sendSuccess, sendError } = require('../utils/helpers')
const Branch = require('../models/Branch')

/**
 * All branch routes are scoped to the authenticated user's company_id.
 * Super Admins can also manage branches for any company by passing
 * companyId in the URL param (:companyId).
 */

function resolveCompanyId(req) {
  // Routes mounted under /companies/:companyId/branches use req.params.companyId
  if (req.params.companyId) return req.params.companyId
  // Fallback: use the logged-in user's company
  return req.user?.company_id?.toString() || null
}

/** GET /api/companies/:companyId/branches */
async function listBranches(req, res) {
  const company_id = resolveCompanyId(req)
  if (!company_id) return sendError(res, 'Company ID required.', 400)

  const { status, search } = req.query
  const branches = await Branch.findAll(company_id, { status, search })
  sendSuccess(res, branches)
}

/** GET /api/companies/:companyId/branches/:id */
async function getBranch(req, res) {
  const company_id = resolveCompanyId(req)
  if (!company_id) return sendError(res, 'Company ID required.', 400)

  const branch = await Branch.findById(req.params.id, company_id)
  if (!branch) return sendError(res, 'Branch not found.', 404)
  sendSuccess(res, branch)
}

/** POST /api/companies/:companyId/branches */
async function createBranch(req, res) {
  const company_id = resolveCompanyId(req)
  if (!company_id) return sendError(res, 'Company ID required.', 400)

  const { name, city, state, address, manager, phone, email, type, status } = req.body
  if (!name || !name.trim()) return sendError(res, 'Branch name is required.')
  if (!city || !city.trim()) return sendError(res, 'City is required.')

  const branch = await Branch.create(company_id, {
    name, city, state, address, manager, phone, email, type, status,
  })
  sendSuccess(res, branch, 'Branch created.', 201)
}

/** PUT /api/companies/:companyId/branches/:id */
async function updateBranch(req, res) {
  const company_id = resolveCompanyId(req)
  if (!company_id) return sendError(res, 'Company ID required.', 400)

  const existing = await Branch.findById(req.params.id, company_id)
  if (!existing) return sendError(res, 'Branch not found.', 404)

  const branch = await Branch.update(req.params.id, company_id, req.body)
  sendSuccess(res, branch, 'Branch updated.')
}

/** DELETE /api/companies/:companyId/branches/:id */
async function deleteBranch(req, res) {
  const company_id = resolveCompanyId(req)
  if (!company_id) return sendError(res, 'Company ID required.', 400)

  const deleted = await Branch.delete(req.params.id, company_id)
  if (!deleted) return sendError(res, 'Branch not found.', 404)
  sendSuccess(res, null, 'Branch deleted.')
}

module.exports = { listBranches, getBranch, createBranch, updateBranch, deleteBranch }
