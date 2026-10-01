const express = require('express');
const router = express.Router();
const ctrl = require('../../controllers/Purchase & Inventory Management/purchaseInvoiceController');
const { allow } = require('../../middleware/roleGuard');

router.get('/', ctrl.list);
router.patch('/:billCode/payment', allow('Company Owner', 'Manager', 'Accountant'), ctrl.recordPayment);

module.exports = router;
