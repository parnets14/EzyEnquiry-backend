const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/HR Management/salaryController');

router.get   ('/',         ctrl.listSalaryRecords);
router.post  ('/',         ctrl.createSalaryRecord);
router.patch ('/:id/pay',  ctrl.paySalary);

module.exports = router;
