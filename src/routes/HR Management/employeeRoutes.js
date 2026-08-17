const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/HR Management/employeeController');

router.get   ('/',    ctrl.listEmployees);
router.get   ('/:id', ctrl.getEmployee);
router.post  ('/',    ctrl.createEmployee);
router.put   ('/:id', ctrl.updateEmployee);
router.delete('/:id', ctrl.deleteEmployee);

module.exports = router;
