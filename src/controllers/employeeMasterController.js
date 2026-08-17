const { sendSuccess, sendError } = require('../utils/helpers')
const EmployeeMaster = require('../models/EmployeeMaster')

// ─────────────────────────────────────────────────────────────
// DEPARTMENTS
// ─────────────────────────────────────────────────────────────

async function listDepartments(req, res) {
  const departments = await EmployeeMaster.listDepartments(req.user.company_id)
  sendSuccess(res, { departments })
}

async function createDepartment(req, res) {
  const { name } = req.body
  if (!name || !name.trim()) return sendError(res, 'Department name is required.')
  const dept = await EmployeeMaster.createDepartment(req.user.company_id, req.body)
  sendSuccess(res, dept, 'Department created.', 201)
}

async function updateDepartment(req, res) {
  const dept = await EmployeeMaster.updateDepartment(req.params.id, req.user.company_id, req.body)
  if (!dept) return sendError(res, 'Department not found.', 404)
  sendSuccess(res, dept, 'Department updated.')
}

async function deleteDepartment(req, res) {
  const result = await EmployeeMaster.deleteDepartment(req.params.id, req.user.company_id)
  if (!result.deleted) return sendError(res, result.reason || 'Department not found.', 400)
  sendSuccess(res, null, 'Department deleted.')
}

// ─────────────────────────────────────────────────────────────
// DESIGNATIONS
// ─────────────────────────────────────────────────────────────

async function listDesignations(req, res) {
  const { department_id } = req.query
  const designations = await EmployeeMaster.listDesignations(req.user.company_id, { department_id })
  sendSuccess(res, { designations })
}

async function createDesignation(req, res) {
  const { department_id, name } = req.body
  if (!department_id) return sendError(res, 'Department is required.')
  if (!name || !name.trim()) return sendError(res, 'Designation name is required.')
  const desig = await EmployeeMaster.createDesignation(req.user.company_id, req.body)
  sendSuccess(res, desig, 'Designation created.', 201)
}

async function updateDesignation(req, res) {
  const desig = await EmployeeMaster.updateDesignation(req.params.id, req.user.company_id, req.body)
  if (!desig) return sendError(res, 'Designation not found.', 404)
  sendSuccess(res, desig, 'Designation updated.')
}

async function deleteDesignation(req, res) {
  const result = await EmployeeMaster.deleteDesignation(req.params.id, req.user.company_id)
  if (!result.deleted) return sendError(res, 'Designation not found.', 404)
  sendSuccess(res, null, 'Designation deleted.')
}

module.exports = {
  listDepartments, createDepartment, updateDepartment, deleteDepartment,
  listDesignations, createDesignation, updateDesignation, deleteDesignation,
}
