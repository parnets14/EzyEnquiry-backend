const express = require('express')
const {
  listPurchases, getPurchase, createPurchase, updatePurchase, deletePurchase,
  updatePurchaseStatus,
  listSuppliers, createSupplier, updateSupplier, deleteSupplier,
} = require('../controllers/financeController')

const router = express.Router()

// ── Supplier sub-routes (must be BEFORE /:id to avoid conflict) ──
router.get   ('/suppliers/all', listSuppliers)
router.post  ('/suppliers',     createSupplier)
router.put   ('/suppliers/:id', updateSupplier)
router.delete('/suppliers/:id', deleteSupplier)

// ── Purchase routes ──────────────────────────────────────────
router.get   ('/',              listPurchases)
router.post  ('/',              createPurchase)
router.get   ('/:id',           getPurchase)
router.put   ('/:id',           updatePurchase)
router.patch ('/:id/status',    updatePurchaseStatus)   // ← persistent status transitions
router.delete('/:id',           deletePurchase)

module.exports = router
