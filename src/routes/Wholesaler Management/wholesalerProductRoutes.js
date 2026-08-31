/**
 * Wholesaler Product Catalog Routes
 * Base: /api/wholesaler/products
 *
 * All routes require authentication.
 * Wholesaler = View Only. No create / edit / delete / rate-setting.
 */
const express = require('express')
const router  = express.Router()
const ctrl    = require('../../controllers/Wholesaler Management/wholesalerProductController')

// Must be before /:id to avoid route conflict
router.get('/filters', ctrl.getFilters)

// Catalog list
router.get('/',    ctrl.listCatalog)

// Single product detail
router.get('/:id', ctrl.getCatalogProduct)

module.exports = router
