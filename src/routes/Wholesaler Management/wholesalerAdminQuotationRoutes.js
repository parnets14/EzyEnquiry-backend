/**
 * Wholesaler Admin Quotation Routes (Super Admin)
 * Base: /api/wholesaler/all-quotations   (authenticate applied at mount)
 */
const express = require('express')
const router  = express.Router()
const ctrl    = require('../../controllers/Wholesaler Management/wholesalerQuotationController')

router.get('/',            ctrl.listAllRequests)   // all product requests, all companies
router.patch('/:id/quote', ctrl.sendQuote)         // admin sends a price quote

module.exports = router
