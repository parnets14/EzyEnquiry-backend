const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Purchase & Inventory Management/purchaseController');
const { allow } = require('../../middleware/roleGuard');

const procureRoles = ['Company Owner', 'Manager', 'Accountant'];

// ── Supplier sub-routes (must be BEFORE /:id) ─────────────────
router.get   ('/suppliers/all', ctrl.listSuppliers);
router.post  ('/suppliers',     allow(...procureRoles), ctrl.createSupplier);
router.put   ('/suppliers/:id', allow(...procureRoles), ctrl.updateSupplier);
router.delete('/suppliers/:id', allow('Company Owner'), ctrl.deleteSupplier);

// ── Purchase routes ───────────────────────────────────────────
router.get   ('/',           ctrl.listPurchases);
router.post  ('/',           allow(...procureRoles), ctrl.createPurchase);
router.get   ('/:id',        ctrl.getPurchase);
router.put   ('/:id',        allow(...procureRoles), ctrl.updatePurchase);
router.patch ('/:id/status', allow(...procureRoles, 'Warehouse Staff'), ctrl.updatePurchaseStatus);
router.delete('/:id',        allow('Company Owner', 'Accountant'), ctrl.deletePurchase);

module.exports = router;
