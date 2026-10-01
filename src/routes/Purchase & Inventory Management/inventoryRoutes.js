const express         = require('express');
const router          = express.Router();
const ctrl            = require('../../controllers/Purchase & Inventory Management/inventoryController');
const warehouseRoutes = require('./warehouseRoutes');
const transferRoutes  = require('./stockTransferRoutes');
const extRoutes       = require('./inventoryExtRoutes');
const { allow }       = require('../../middleware/roleGuard');
const { MODULES, moduleAccess } = require('../../config/permissions');

// Sub-routes (mounted before root handlers)
router.use('/warehouses', moduleAccess(MODULES.WAREHOUSES), warehouseRoutes);
router.use('/transfers',  moduleAccess(MODULES.STOCK_TRANSFER), transferRoutes);

// Extended inventory sub-modules (units, rack-bins, opening-stock, batches,
// shades, calibers, damages, adjustments, ledger, reports)
router.use('/', extRoutes);

// ── Read ──────────────────────────────────────────────────────────────────────
router.get('/',           moduleAccess(MODULES.INVENTORY), ctrl.listInventory);
router.get('/summary',    moduleAccess(MODULES.INVENTORY_DASHBOARD), ctrl.getInventorySummary);   // dashboard KPIs
router.get('/movements',  moduleAccess(MODULES.STOCK_LEDGER), ctrl.listMovements);         // stock movement history
router.get('/:id',        moduleAccess(MODULES.INVENTORY), ctrl.getInventoryItem);

// ── Stock mutations ───────────────────────────────────────────────────────────
// Only Owner/Manager/Warehouse Staff can mutate inventory
const stockRoles = ['Company Owner', 'Manager', 'Warehouse Staff', 'Super Admin'];

router.patch('/:id/settings',     moduleAccess(MODULES.INVENTORY), allow(...stockRoles), ctrl.updateInventorySettings);
router.patch('/adjust',           moduleAccess(MODULES.INVENTORY), allow(...stockRoles), ctrl.adjustStock);
router.patch('/reserve',          moduleAccess(MODULES.INVENTORY), allow(...stockRoles), ctrl.reserveStock);
router.patch('/release-reserve',  moduleAccess(MODULES.INVENTORY), allow(...stockRoles), ctrl.releaseReserve);
router.patch('/start-picking',    moduleAccess(MODULES.INVENTORY), allow(...stockRoles), ctrl.startPicking);
router.patch('/complete-packing', moduleAccess(MODULES.INVENTORY), allow(...stockRoles), ctrl.completePacking);
router.patch('/dispatch-stock-out', moduleAccess(MODULES.INVENTORY), allow(...stockRoles), ctrl.dispatchStockOut);
router.patch('/block',            moduleAccess(MODULES.INVENTORY), allow(...stockRoles), ctrl.blockStock);

module.exports = router;
