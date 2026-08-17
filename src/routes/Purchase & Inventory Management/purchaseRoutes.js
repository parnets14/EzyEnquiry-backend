const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Purchase & Inventory Management/purchaseController');

// ── Supplier sub-routes (must be BEFORE /:id) ─────────────────
router.get   ('/suppliers/all', ctrl.listSuppliers);
router.post  ('/suppliers',     ctrl.createSupplier);
router.put   ('/suppliers/:id', ctrl.updateSupplier);
router.delete('/suppliers/:id', ctrl.deleteSupplier);

// ── Purchase routes ───────────────────────────────────────────
router.get   ('/',           ctrl.listPurchases);
router.post  ('/',           ctrl.createPurchase);
router.get   ('/:id',        ctrl.getPurchase);
router.put   ('/:id',        ctrl.updatePurchase);
router.patch ('/:id/status', ctrl.updatePurchaseStatus);
router.delete('/:id',        ctrl.deletePurchase);

module.exports = router;
