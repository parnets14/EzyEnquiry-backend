/**
 * Wholesaler Admin Routes  (Super Admin visibility into wholesaler activity)
 * Base: /api/wholesaler/all-purchases   (authenticate applied at mount)
 */
const express = require('express')
const router  = express.Router()
const ctrl    = require('../../controllers/Wholesaler Management/wholesalerPurchaseController')

// GET   /api/wholesaler/all-purchases          — all wholesaler purchases across companies
router.get('/', ctrl.listAllPurchases)
// GET   /api/wholesaler/all-purchases/:id      — single purchase-order (admin)
router.get('/:id', ctrl.getAdminPurchase)
// PATCH /api/wholesaler/all-purchases/:id/approve — approve → Order + Invoice
router.patch('/:id/approve', ctrl.approvePurchaseOrder)
// PATCH /api/wholesaler/all-purchases/:id/reject  — reject → Cancelled
router.patch('/:id/reject', ctrl.rejectPurchaseOrder)
// DELETE /api/wholesaler/all-purchases/:id        — delete a purchase-order
router.delete('/:id', ctrl.deletePurchaseOrder)

module.exports = router
