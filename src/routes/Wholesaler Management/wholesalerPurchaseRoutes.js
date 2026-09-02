/**
 * Wholesaler Purchase Routes
 * Base: /api/wholesaler/purchases   (authenticate applied at mount)
 *
 * Lets a wholesaler buy items into their own inventory.
 */
const express = require('express')
const router  = express.Router()
const ctrl    = require('../../controllers/Wholesaler Management/wholesalerPurchaseController')

router.post('/',    ctrl.createPurchase)
router.get('/',     ctrl.listPurchases)
router.get('/:id',  ctrl.getPurchase)

module.exports = router
