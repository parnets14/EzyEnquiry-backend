/**
 * inventoryExtRoutes.js
 * Extended inventory sub-routes mounted under /api/inventory/
 *   /units            → Unit Conversion
 *   /rack-bins        → Rack / Bin locations
 *   /opening-stock    → Opening Stock entries
 *   /batches          → Batch / Lot
 *   /shades           → Shade codes
 *   /calibers         → Caliber codes
 *   /damages          → Damage / Breakage records
 *   /adjustments      → Stock Adjustments
 *   /ledger           → Stock Ledger (movements)
 *   /reports/*        → Inventory Reports
 */
const express = require('express');
const router  = express.Router();
const { allow } = require('../../middleware/roleGuard');
const { MODULES, moduleAccess } = require('../../config/permissions');

const {
  unitConversionCtrl,
  rackBinCtrl,
  batchCtrl,
  shadeCtrl,
  damageCtrl,
  stockAdjCtrl,
  stockLedgerCtrl,
  inventoryReportCtrl,
} = require('../../controllers/Purchase & Inventory Management/inventorySubController');

const openingCtrl = require('../../controllers/Purchase & Inventory Management/openingStockController');

const stockRoles  = ['Company Owner', 'Manager', 'Warehouse Staff'];
const reportRoles = ['Company Owner', 'Manager', 'Accountant'];

// Each inventory sub-page has its own module permission. These guards run
// before the handlers while keeping the shared /api/inventory URL structure.
router.use('/units',       moduleAccess(MODULES.UNIT_CONVERSION));
router.use('/rack-bins',   moduleAccess(MODULES.RACK_BIN));
router.use('/opening-stock', moduleAccess(MODULES.OPENING_STOCK));
router.use('/batches',     moduleAccess(MODULES.BATCH_LOT));
router.use('/shades',      moduleAccess(MODULES.SHADE_CALIBER));
router.use('/calibers',    moduleAccess(MODULES.SHADE_CALIBER));
router.use('/damages',     moduleAccess(MODULES.DAMAGE_BREAKAGE));
router.use('/adjustments', moduleAccess(MODULES.STOCK_ADJUSTMENT));
router.use('/ledger',      moduleAccess(MODULES.STOCK_LEDGER));
router.use('/reports',     moduleAccess(MODULES.INVENTORY_REPORTS));

// ── Unit Conversion ───────────────────────────────────────────
router.get   ('/units',                   unitConversionCtrl.list);
router.get   ('/units/product/:productId',unitConversionCtrl.forProduct);
router.get   ('/units/:id',               unitConversionCtrl.get);
router.post  ('/units',                   allow(...stockRoles), unitConversionCtrl.create);
router.put   ('/units/:id',               allow(...stockRoles), unitConversionCtrl.update);
router.delete('/units/:id',               allow('Company Owner','Manager'), unitConversionCtrl.remove);

// ── Rack / Bin ─────────────────────────────────────────────────
router.get   ('/rack-bins',                          rackBinCtrl.list);
router.get   ('/rack-bins/warehouse/:warehouseId',   rackBinCtrl.forWarehouse);
router.get   ('/rack-bins/:id',                      rackBinCtrl.get);
router.post  ('/rack-bins',                          allow(...stockRoles), rackBinCtrl.create);
router.put   ('/rack-bins/:id',                      allow(...stockRoles), rackBinCtrl.update);
router.delete('/rack-bins/:id',                      allow('Company Owner','Manager'), rackBinCtrl.remove);

// ── Opening Stock ─────────────────────────────────────────────
router.get   ('/opening-stock',     openingCtrl.list);
router.get   ('/opening-stock/:id', openingCtrl.get);
router.post  ('/opening-stock',     allow(...stockRoles), openingCtrl.create);
router.put   ('/opening-stock/:id', allow(...stockRoles), openingCtrl.update);
router.delete('/opening-stock/:id', allow('Company Owner','Manager'), openingCtrl.remove);

// ── Batch / Lot ────────────────────────────────────────────────
router.get   ('/batches',            batchCtrl.list);
router.get   ('/batches/:id',        batchCtrl.get);
router.get   ('/batches/:id/stock',  batchCtrl.stock);
router.post  ('/batches',            allow(...stockRoles), batchCtrl.create);
router.put   ('/batches/:id',        allow(...stockRoles), batchCtrl.update);
router.delete('/batches/:id',        allow('Company Owner','Manager'), batchCtrl.remove);

// ── Shades ─────────────────────────────────────────────────────
router.get   ('/shades',             shadeCtrl.listShades);
router.post  ('/shades',             allow(...stockRoles), shadeCtrl.createShade);
router.put   ('/shades/:id',         allow(...stockRoles), shadeCtrl.updateShade);
router.delete('/shades/:id',         allow('Company Owner','Manager'), shadeCtrl.deleteShade);

// ── Calibers ───────────────────────────────────────────────────
router.get   ('/calibers',           shadeCtrl.listCalibers);
router.post  ('/calibers',           allow(...stockRoles), shadeCtrl.createCaliber);
router.put   ('/calibers/:id',       allow(...stockRoles), shadeCtrl.updateCaliber);
router.delete('/calibers/:id',       allow('Company Owner','Manager'), shadeCtrl.deleteCaliber);

// ── Damage / Breakage ──────────────────────────────────────────
router.get   ('/damages',              damageCtrl.list);
router.get   ('/damages/:id',          damageCtrl.get);
router.post  ('/damages',              allow(...stockRoles), damageCtrl.create);
router.put   ('/damages/:id',          allow(...stockRoles), damageCtrl.update);
router.patch ('/damages/:id/approve',  allow('Company Owner','Manager'), damageCtrl.approve);
router.delete('/damages/:id',          allow('Company Owner','Manager'), damageCtrl.remove);

// ── Stock Adjustments ──────────────────────────────────────────
router.get   ('/adjustments',              stockAdjCtrl.list);
router.get   ('/adjustments/:id',          stockAdjCtrl.get);
router.post  ('/adjustments',              allow(...stockRoles), stockAdjCtrl.create);
router.patch ('/adjustments/:id/approve',  allow('Company Owner','Manager'), stockAdjCtrl.approve);
router.patch ('/adjustments/:id/reject',   allow('Company Owner','Manager'), stockAdjCtrl.reject);
router.delete('/adjustments/:id',          allow('Company Owner','Manager'), stockAdjCtrl.remove);

// ── Stock Ledger ───────────────────────────────────────────────
router.get('/ledger',                     stockLedgerCtrl.list);
router.get('/ledger/export',              stockLedgerCtrl.export);
router.get('/ledger/product/:productId',  stockLedgerCtrl.productSummary);

// ── Inventory Reports ──────────────────────────────────────────
router.get('/reports/current-stock',  allow(...reportRoles), inventoryReportCtrl.currentStock);
router.get('/reports/valuation',      allow(...reportRoles), inventoryReportCtrl.stockValuation);
router.get('/reports/low-stock',      allow(...reportRoles), inventoryReportCtrl.lowStock);
router.get('/reports/movements',      allow(...reportRoles), inventoryReportCtrl.movementReport);
router.get('/reports/damage',         allow(...reportRoles), inventoryReportCtrl.damageReport);
router.get('/reports/batch',          allow(...reportRoles), inventoryReportCtrl.batchReport);
router.get('/reports/transfers',      allow(...reportRoles), inventoryReportCtrl.transferReport);

module.exports = router;
