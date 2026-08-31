/**
 * Wholesaler Warehouse Routes
 * Base: /api/wholesaler/warehouses
 * View-only — wholesaler cannot create or delete warehouses.
 */
const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Wholesaler Management/wholesalerInventoryController');

router.get('/', ctrl.listWarehouses);

module.exports = router;
