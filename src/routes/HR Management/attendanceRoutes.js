const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/HR Management/attendanceController');

router.get ('/',       ctrl.listAttendance);
router.get ('/summary', ctrl.getAttendanceSummary);
router.post('/mark',   ctrl.markAttendance);

module.exports = router;
