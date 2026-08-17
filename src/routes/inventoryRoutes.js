const express = require('express')
const {
  // Inventory
  listInventory,
  adjustStock,
  listStockMovements,
  // Warehouses
  listWarehouses,
  getWarehouse,
  getWarehouseStock,
  createWarehouse,
  updateWarehouse,
  deleteWarehouse,
  // Transfers
  listStockTransfers,
  getStockTransfer,
  createStockTransfer,
  updateTransferStatus,
  deleteStockTransfer,
} = require('../controllers/inventoryController')

const router = express.Router()

// ── Inventory ──────────────────────────────────────────────
router.get   ('/',                       listInventory)
router.patch ('/adjust',                 adjustStock)
router.get   ('/movements',              listStockMovements)   // ← stock movement audit trail

// ── Warehouses (static routes BEFORE /:id) ────────────────
router.get   ('/warehouses',             listWarehouses)
router.post  ('/warehouses',             createWarehouse)
router.get   ('/warehouses/:id/stock',   getWarehouseStock)
router.get   ('/warehouses/:id',         getWarehouse)
router.put   ('/warehouses/:id',         updateWarehouse)
router.delete('/warehouses/:id',         deleteWarehouse)

// ── Stock Transfers (static routes BEFORE /:id) ───────────
router.get   ('/transfers',              listStockTransfers)
router.post  ('/transfers',              createStockTransfer)
router.get   ('/transfers/:id',          getStockTransfer)
router.patch ('/transfers/:id/status',   updateTransferStatus)
router.delete('/transfers/:id',          deleteStockTransfer)

module.exports = router
