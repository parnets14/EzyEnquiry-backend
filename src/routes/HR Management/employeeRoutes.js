const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/HR Management/employeeController');
const { MODULES, moduleAccess } = require('../../config/permissions');
const { authorize } = require('../../middleware/auth');

// Super Admin — all staff across every company (grouped by business in the CRM).
// Declared before the company-scoped EMPLOYEES gate and before '/:id'.
router.get('/admin/all', authorize('Super Admin'), ctrl.listAllEmployees);

// Attendance sub-routes: /api/employees/attendance/*  → gated by ATTENDANCE module.
const attRoutes = require('./attendanceRoutes');
router.use('/attendance', moduleAccess(MODULES.ATTENDANCE), attRoutes);

// Salary sub-routes: /api/employees/salary/records  → gated by SALARY module.
const salRoutes = require('./salaryRoutes');
router.use('/salary/records', moduleAccess(MODULES.SALARY), salRoutes);

// Employee CRUD — gated by the EMPLOYEES module.
router.use(moduleAccess(MODULES.EMPLOYEES));
router.get   ('/',    ctrl.listEmployees);
router.post  ('/',    ctrl.createEmployee);
router.get   ('/:id', ctrl.getEmployee);
router.get   ('/:id/incentive', ctrl.getEmployeeIncentive);
router.put   ('/:id', ctrl.updateEmployee);
router.delete('/:id', ctrl.deleteEmployee);

module.exports = router;
