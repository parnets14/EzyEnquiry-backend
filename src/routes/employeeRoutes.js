const express = require('express')
const {
  listEmployees, getEmployee, createEmployee, updateEmployee, deleteEmployee,
  listAttendance, markAttendance,
  listSalaryRecords, createSalaryRecord, paySalary,
} = require('../controllers/hrController')

const router = express.Router()

// ── Sub-routes (must be BEFORE /:id) ──────────────────────────
router.get   ('/attendance/list',        listAttendance)
router.post  ('/attendance/mark',        markAttendance)
router.get   ('/salary/records',         listSalaryRecords)
router.post  ('/salary/records',         createSalaryRecord)
router.patch ('/salary/records/:id/pay', paySalary)

// ── Employee CRUD ─────────────────────────────────────────────
router.get   ('/',    listEmployees)
router.post  ('/',    createEmployee)
router.get   ('/:id', getEmployee)
router.put   ('/:id', updateEmployee)
router.delete('/:id', deleteEmployee)

module.exports = router
