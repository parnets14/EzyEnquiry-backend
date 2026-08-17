const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Purchase & Inventory Management/warehouseController');

router.get   ('/',             ctrl.listWarehouses);
router.get   ('/:id/stock',    ctrl.getWarehouseStock);
router.get   ('/:id',          ctrl.getWarehouse);
router.post  ('/',             ctrl.createWarehouse);
router.put   ('/:id',          ctrl.updateWarehouse);
router.delete('/:id',          ctrl.deleteWarehouse);

module.exports = router;
