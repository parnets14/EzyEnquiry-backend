const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Finance Management/accountsController');

// ── Customer & Supplier Ledgers ───────────────────────────────
router.get('/ledger/customer', ctrl.getCustomerLedger);  // ?customer_id=xxx
router.get('/ledger/supplier', ctrl.getSupplierLedger);  // ?supplier_id=xxx

// ── Cash Book & Bank Book ─────────────────────────────────────
router.get('/cash-book', ctrl.getCashBook);   // ?from_date=&to_date=
router.get('/bank-book', ctrl.getBankBook);   // ?from_date=&to_date=

module.exports = router;
