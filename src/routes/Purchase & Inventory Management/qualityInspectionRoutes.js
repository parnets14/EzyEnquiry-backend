const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Purchase & Inventory Management/qualityInspectionController');
const { allow } = require('../../middleware/roleGuard');

const roles = ['Company Owner', 'Manager', 'Warehouse Staff'];

router.get   ('/',            ctrl.list);
router.get   ('/:id',         ctrl.get);
router.post  ('/',            allow(...roles, 'Accountant'), ctrl.create);
router.put   ('/:id',         allow(...roles), ctrl.update);
router.patch ('/:id/approve', allow(...roles), ctrl.approve);
router.patch ('/:id/reject',  allow(...roles), ctrl.reject);
router.delete('/:id',         allow('Company Owner', 'Manager'), ctrl.remove);

module.exports = router;
