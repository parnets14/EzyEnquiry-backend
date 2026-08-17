const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Finance Management/paymentController');

router.get   ('/receivables',             ctrl.listReceivables);
router.get   ('/payables',                ctrl.listPayables);
router.get   ('/transactions',            ctrl.listTransactions);
router.patch ('/receivables/:id/collect', ctrl.collectReceivable);
router.patch ('/payables/:id/pay',        ctrl.payPayable);

module.exports = router;
