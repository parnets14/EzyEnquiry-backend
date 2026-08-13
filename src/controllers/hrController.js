const { sendSuccess, sendError, paginate } = require('../utils/helpers')
const { Employee }                         = require('../models')

// ─────────────────────────────────────────────────────────────
// EMPLOYEES
// ─────────────────────────────────────────────────────────────

async function listEmployees(req, res) {
  const { department, is_active, page = 1, limit = 20 } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)

  const [total, employees] = await Promise.all([
    Employee.count(req.user.company_id, { department, is_active }),
    Employee.findAll(req.user.company_id, { department, is_active, limit: parseInt(limit), offset }),
  ])

  sendSuccess(res, { employees, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

async function getEmployee(req, res) {
  const emp = await Employee.findById(req.params.id, req.user.company_id)
  if (!emp) return sendError(res, 'Employee not found.', 404)

  const attendance = await Employee.findAttendance(req.user.company_id, {
    employee_id: req.params.id,
    limit: 30,
    offset: 0,
  })

  sendSuccess(res, { ...emp, attendance })
}

async function createEmployee(req, res) {
  const { name } = req.body
  if (!name) return sendError(res, 'Employee name is required.')

  const emp = await Employee.create(req.user.company_id, req.body)
  sendSuccess(res, emp, 'Employee created.', 201)
}

async function updateEmployee(req, res) {
  const emp = await Employee.update(req.params.id, req.user.company_id, req.body)
  if (!emp) return sendError(res, 'Employee not found.', 404)
  sendSuccess(res, emp, 'Employee updated.')
}

async function deleteEmployee(req, res) {
  const deleted = await Employee.delete(req.params.id, req.user.company_id)
  if (!deleted) return sendError(res, 'Employee not found.', 404)
  sendSuccess(res, null, 'Employee deleted.')
}

// ─────────────────────────────────────────────────────────────
// ATTENDANCE
// ─────────────────────────────────────────────────────────────

async function listAttendance(req, res) {
  const { employee_id, date, page = 1, limit = 50 } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)

  const [total, attendance] = await Promise.all([
    Employee.count(req.user.company_id, {}),  // simple fallback — count all employees
    Employee.findAttendance(req.user.company_id, { employee_id, date, limit: parseInt(limit), offset }),
  ])

  sendSuccess(res, { attendance, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

async function markAttendance(req, res) {
  const { employee_id, date } = req.body
  if (!employee_id || !date) {
    return sendError(res, 'employee_id and date are required.')
  }

  const att = await Employee.markAttendance(req.user.company_id, req.body)
  sendSuccess(res, att, 'Attendance marked.')
}

// ─────────────────────────────────────────────────────────────
// SALARY
// ─────────────────────────────────────────────────────────────

async function listSalaryRecords(req, res) {
  const { employee_id, month, year, page = 1, limit = 20 } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)

  const salaries = await Employee.findSalaryRecords(req.user.company_id, {
    employee_id, month, year, limit: parseInt(limit), offset,
  })

  sendSuccess(res, { salaries })
}

async function createSalaryRecord(req, res) {
  const { employee_id, month, year, basic_salary } = req.body
  if (!employee_id || !month || !year || !basic_salary) {
    return sendError(res, 'employee_id, month, year and basic_salary are required.')
  }

  const sal = await Employee.createSalaryRecord(req.user.company_id, req.body)
  sendSuccess(res, sal, 'Salary record created.', 201)
}

async function paySalary(req, res) {
  const sal = await Employee.paySalary(req.params.id, req.user.company_id, req.body)
  if (!sal) return sendError(res, 'Salary record not found.', 404)
  sendSuccess(res, sal, 'Salary marked as paid.')
}

module.exports = {
  listEmployees, getEmployee, createEmployee, updateEmployee, deleteEmployee,
  listAttendance, markAttendance,
  listSalaryRecords, createSalaryRecord, paySalary,
}
