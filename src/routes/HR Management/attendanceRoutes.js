const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/HR Management/attendanceController');

router.get ('/',     ctrl.listAttendance);
router.post('/mark', ctrl.markAttendance);

module.exports = router;
