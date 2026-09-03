/**
 * Wholesaler Quotation Routes
 * Base: /api/wholesaler/quotations   (authenticate applied at mount)
 */
const express = require('express')
const router  = express.Router()
const ctrl    = require('../../controllers/Wholesaler Management/wholesalerQuotationController')

router.post('/',              ctrl.createRequest)
router.get('/',               ctrl.listMyRequests)
router.get('/:id',            ctrl.getRequest)
router.patch('/:id/respond',  ctrl.respondToQuote)

module.exports = router
