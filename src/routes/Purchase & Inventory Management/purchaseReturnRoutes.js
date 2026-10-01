const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Purchase & Inventory Management/purchaseReturnController');
const { allow } = require('../../middleware/roleGuard');

const roles = ['Company Owner', 'Manager', 'Accountant'];

router.get   ('/',            ctrl.list);
router.get   ('/:id',         ctrl.get);
router.post  ('/',            allow(...roles), ctrl.create);
router.put   ('/:id',         allow(...roles), ctrl.update);
router.patch ('/:id/status',  allow(...roles), ctrl.updateStatus);
router.delete('/:id',         allow('Company Owner', 'Manager'), ctrl.remove);

module.exports = router;
