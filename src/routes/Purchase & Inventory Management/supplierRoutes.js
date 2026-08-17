const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Purchase & Inventory Management/supplierController');

router.get   ('/',    ctrl.listSuppliers);
router.get   ('/all', ctrl.listSuppliers);   // alias: /api/purchases/suppliers/all
router.get   ('/:id', ctrl.getSupplier);
router.post  ('/',    ctrl.createSupplier);
router.put   ('/:id', ctrl.updateSupplier);
router.delete('/:id', ctrl.deleteSupplier);

module.exports = router;
