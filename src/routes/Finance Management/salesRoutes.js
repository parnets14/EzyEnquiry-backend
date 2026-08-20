const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Finance Management/saleController');
const { allow } = require('../../middleware/roleGuard');

const salesRoles = ['Company Owner', 'Manager', 'Accountant', 'Sales Executive'];

router.get ('/', ctrl.listSales);
router.post('/', allow(...salesRoles), ctrl.createSale);

module.exports = router;
