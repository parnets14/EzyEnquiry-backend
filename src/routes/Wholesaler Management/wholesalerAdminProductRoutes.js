/**
 * Wholesaler Admin Product Routes  (Super Admin)
 * Base: /api/wholesaler/all-products   (authenticate applied at mount)
 *
 *   GET    /:id   view a wholesaler-added product (any company)
 *   DELETE /:id   soft-delete a wholesaler-added product (any company)
 */
const express = require('express')
const router  = express.Router()
const ctrl    = require('../../controllers/Wholesaler Management/wholesalerProductController')

router.get('/:id',    ctrl.getAdminProduct)
router.delete('/:id', ctrl.deleteAdminProduct)

module.exports = router
