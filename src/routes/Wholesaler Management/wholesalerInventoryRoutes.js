/**
 * Wholesaler Inventory & Warehouse Routes
 * Base paths (mounted in server.js):
 *   /api/wholesaler/inventory
 *   /api/wholesaler/warehouses
 *
 * All routes require authentication (authenticate middleware applied at mount point).
 * Wholesaler = VIEW ONLY. No stock mutations allowed here.
 */
const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Wholesaler Management/wholesalerInventoryController');

// ── Summary / KPIs (before /:id to avoid conflict) ───────────────────────────
router.get('/summary',   ctrl.getInventorySummary);
router.get('/movements', ctrl.listMovements);

// ── List & Detail ─────────────────────────────────────────────────────────────
router.get('/',    ctrl.listInventory);
router.get('/:id', ctrl.getInventoryItem);

module.exports = router;
