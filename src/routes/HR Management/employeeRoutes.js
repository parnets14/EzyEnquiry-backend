const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/HR Management/employeeController');

// Attendance sub-routes: /api/employees/attendance/*
const attRoutes = require('./attendanceRoutes');
router.use('/attendance', attRoutes);

// Salary sub-routes: /api/employees/salary/records
const salRoutes = require('./salaryRoutes');
router.use('/salary/records', salRoutes);

// Employee CRUD
router.get   ('/',    ctrl.listEmployees);
router.post  ('/',    ctrl.createEmployee);
router.get   ('/:id', ctrl.getEmployee);
router.put   ('/:id', ctrl.updateEmployee);
router.delete('/:id', ctrl.deleteEmployee);

module.exports = router;
