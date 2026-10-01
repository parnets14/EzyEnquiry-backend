const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Purchase & Inventory Management/grnController');
const { allow } = require('../../middleware/roleGuard');

const roles = ['Company Owner', 'Manager', 'Accountant', 'Warehouse Staff'];

router.get   ('/',            ctrl.list);
router.get   ('/:id',         ctrl.get);
router.post  ('/',            allow(...roles), ctrl.create);
router.put   ('/:id',         allow(...roles), ctrl.update);
router.patch ('/:id/approve', allow('Company Owner', 'Manager', 'Warehouse Staff'), ctrl.approve);
router.patch ('/:id/cancel',  allow('Company Owner', 'Manager'), ctrl.cancel);
router.delete('/:id',         allow('Company Owner', 'Manager'), ctrl.remove);

module.exports = router;
