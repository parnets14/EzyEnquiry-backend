const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Finance Management/saleController');
const { allow } = require('../../middleware/roleGuard');

const salesRoles = ['Company Owner', 'Manager', 'Accountant', 'Sales Executive'];

router.get ('/',            ctrl.listSales);
router.get ('/report',      ctrl.salesReport);
router.get ('/:id',         ctrl.getSale);
router.post('/',            allow(...salesRoles), ctrl.createSale);
router.patch('/:id/payment', allow(...salesRoles), ctrl.recordPayment);

module.exports = router;
