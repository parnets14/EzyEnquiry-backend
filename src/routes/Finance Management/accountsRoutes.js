const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Finance Management/accountsController');

// ── Ledgers ──────────────────────────────────────────────────
router.get('/ledger/customer', ctrl.getCustomerLedger);  // GET /api/accounts/ledger/customer?customer_id=xxx
router.get('/ledger/supplier', ctrl.getSupplierLedger);  // GET /api/accounts/ledger/supplier?supplier_id=xxx

// ── Cash Book & Bank Book ─────────────────────────────────────
router.get('/cash-book',  ctrl.getCashBook);   // GET /api/accounts/cash-book?from_date=&to_date=
router.get('/bank-book',  ctrl.getBankBook);   // GET /api/accounts/bank-book?from_date=&to_date=

module.exports = router;
