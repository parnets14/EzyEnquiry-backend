/**
 * Wholesaler Invoice Routes  (wholesaler app — own company's invoices)
 * Base: /api/wholesaler/invoices   (authenticate applied at mount)
 *
 *   GET /       list my company's invoices
 *   GET /:id    single invoice
 */
const express = require('express')
const router  = express.Router()
const ctrl    = require('../../controllers/Wholesaler Management/wholesalerPurchaseController')

router.get('/',    ctrl.listMyInvoices)
router.get('/:id', ctrl.getMyInvoice)

module.exports = router
