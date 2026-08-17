const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Finance Management/accountsController');

router.get('/ledger/customer', ctrl.getCustomerLedger);
router.get('/ledger/supplier', ctrl.getSupplierLedger);

module.exports = router;
