const { sendSuccess, sendError } = require('../../utils/helpers')
const Branch = require('../../models/Company Management/Branch')

// Routes are mounted under /api/companies/:companyId/branches
// req.params.companyId is available via mergeParams: true on the router
function getCompanyId(req) {
  return req.params.companyId || req.user?.company_id?.toString() || null
}

// ── Helper: generate next branch code ────────────────────────
async function getNextBranchCode(company_id) {
  const count = await Branch.countDocuments({ company_id })
  return `BR-${String(count + 1).padStart(3, '0')}`
}

/** GET /api/companies/:companyId/branches */
async function listBranches(req, res) {
  const company_id = getCompanyId(req)
  if (!company_id) return sendError(res, 'Company ID required.', 400)

  const { status, search } = req.query
  const query = { company_id }
  if (status && status !== 'All') query.status = status
  if (search) {
    query.$or = [
      { name:    { $regex: search, $options: 'i' } },
      { city:    { $regex: search, $options: 'i' } },
      { manager: { $regex: search, $options: 'i' } },
    ]
  }

  const branches = await Branch.find(query).sort({ created_at: -1 }).lean()
  sendSuccess(res, branches)
}

/** GET /api/companies/:companyId/branches/:id */
async function getBranch(req, res) {
  const company_id = getCompanyId(req)
  if (!company_id) return sendError(res, 'Company ID required.', 400)

  const branch = await Branch.findOne({ _id: req.params.id, company_id }).lean()
  if (!branch) return sendError(res, 'Branch not found.', 404)
  sendSuccess(res, branch)
}

/** POST /api/companies/:companyId/branches */
async function createBranch(req, res) {
  const company_id = getCompanyId(req)
  if (!company_id) return sendError(res, 'Company ID required.', 400)

  const { name, city, state, address, manager, phone, email, type, status } = req.body
  if (!name?.trim()) return sendError(res, 'Branch name is required.')
  if (!city?.trim()) return sendError(res, 'City is required.')

  const code = await getNextBranchCode(company_id)
  const branch = await Branch.create({
    company_id, code, name,
    city:    city    || '',
    state:   state   || '',
    address: address || '',
    manager: manager || '',
    phone:   phone   || '',
    email:   email   || '',
    type:    type    || '',
    status:  status  || 'Active',
  })
  sendSuccess(res, branch, 'Branch created.', 201)
}

/** PUT /api/companies/:companyId/branches/:id */
async function updateBranch(req, res) {
  const company_id = getCompanyId(req)
  if (!company_id) return sendError(res, 'Company ID required.', 400)

  const { name, city, state, address, manager, phone, email, type, status } = req.body
  const update = {}
  if (name    !== undefined) update.name    = name
  if (city    !== undefined) update.city    = city
  if (state   !== undefined) update.state   = state
  if (address !== undefined) update.address = address
  if (manager !== undefined) update.manager = manager
  if (phone   !== undefined) update.phone   = phone
  if (email   !== undefined) update.email   = email
  if (type    !== undefined) update.type    = type
  if (status  !== undefined) update.status  = status

  const branch = await Branch.findOneAndUpdate({ _id: req.params.id, company_id }, update, { new: true }).lean()
  if (!branch) return sendError(res, 'Branch not found.', 404)
  sendSuccess(res, branch, 'Branch updated.')
}

/** DELETE /api/companies/:companyId/branches/:id */
async function deleteBranch(req, res) {
  const company_id = getCompanyId(req)
  if (!company_id) return sendError(res, 'Company ID required.', 400)

  const result = await Branch.deleteOne({ _id: req.params.id, company_id })
  if (result.deletedCount === 0) return sendError(res, 'Branch not found.', 404)
  sendSuccess(res, null, 'Branch deleted.')
}

module.exports = { listBranches, getBranch, createBranch, updateBranch, deleteBranch }
