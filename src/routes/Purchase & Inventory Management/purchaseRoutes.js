const express        = require('express');
const router         = express.Router();
const ctrl           = require('../../controllers/Purchase & Inventory Management/purchaseController');
const supplierRoutes = require('./supplierRoutes');

// Supplier sub-routes: /api/purchases/suppliers/...
router.use('/suppliers', supplierRoutes);

router.get   ('/',    ctrl.listPurchases);
router.get   ('/:id', ctrl.getPurchase);
router.post  ('/',    ctrl.createPurchase);
router.put   ('/:id', ctrl.updatePurchase);
router.delete('/:id', ctrl.deletePurchase);

module.exports = router;
