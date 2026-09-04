const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/HR Management/attendanceController');

// Frontend calls: /employees/attendance/list  and  /employees/attendance/summary
router.get ('/list',    ctrl.listAttendance);
router.get ('/summary', ctrl.getAttendanceSummary);
router.get ('/monthly', ctrl.getMonthlyReport);
router.post('/mark',    ctrl.markAttendance);

module.exports = router;
