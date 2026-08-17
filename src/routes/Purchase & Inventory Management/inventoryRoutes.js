const express           = require('express');
const router            = express.Router();
const ctrl              = require('../../controllers/Purchase & Inventory Management/inventoryController');
const warehouseRoutes   = require('./warehouseRoutes');
const transferRoutes    = require('./stockTransferRoutes');

// Sub-routes
router.use('/warehouses', warehouseRoutes);
router.use('/transfers',  transferRoutes);

router.get   ('/',       ctrl.listInventory);
router.patch ('/adjust', ctrl.adjustStock);

module.exports = router;
