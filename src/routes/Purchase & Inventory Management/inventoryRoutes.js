const express         = require('express');
const router          = express.Router();
const ctrl            = require('../../controllers/Purchase & Inventory Management/inventoryController');
const warehouseRoutes = require('./warehouseRoutes');
const transferRoutes  = require('./stockTransferRoutes');
const { allow }       = require('../../middleware/roleGuard');

// Sub-routes (mounted before root handlers)
router.use('/warehouses', warehouseRoutes);
router.use('/transfers',  transferRoutes);

// ── Read ──────────────────────────────────────────────────────────────────────
router.get('/',           ctrl.listInventory);
router.get('/summary',    ctrl.getInventorySummary);   // dashboard KPIs
router.get('/movements',  ctrl.listMovements);         // stock movement history
router.get('/:id',        ctrl.getInventoryItem);

// ── Stock mutations ───────────────────────────────────────────────────────────
// Only Owner/Manager/Warehouse Staff can mutate inventory
const stockRoles = ['Company Owner', 'Manager', 'Warehouse Staff', 'Super Admin'];

router.patch('/adjust',           allow(...stockRoles), ctrl.adjustStock);
router.patch('/reserve',          allow(...stockRoles), ctrl.reserveStock);
router.patch('/release-reserve',  allow(...stockRoles), ctrl.releaseReserve);
router.patch('/start-picking',    allow(...stockRoles), ctrl.startPicking);
router.patch('/complete-packing', allow(...stockRoles), ctrl.completePacking);
router.patch('/dispatch-stock-out', allow(...stockRoles), ctrl.dispatchStockOut);
router.patch('/block',            allow(...stockRoles), ctrl.blockStock);

module.exports = router;
