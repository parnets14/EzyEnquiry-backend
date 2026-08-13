const express = require('express')
const {
  listReceivables, listPayables, listTransactions, collectReceivable, payPayable,
  getProfitLoss, getCustomerLedger, getSupplierLedger,
} = require('../controllers/financeController')

const router = express.Router()

router.get   ('/receivables',              listReceivables)
router.get   ('/payables',                 listPayables)
router.get   ('/transactions',             listTransactions)
router.patch ('/receivables/:id/collect',  collectReceivable)
router.patch ('/payables/:id/pay',         payPayable)
router.get   ('/profit-loss',              getProfitLoss)
router.get   ('/ledger/customer',          getCustomerLedger)
router.get   ('/ledger/supplier',          getSupplierLedger)

module.exports = router
