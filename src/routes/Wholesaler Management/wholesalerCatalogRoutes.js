const express = require('express')
const marketplaceController = require('../../controllers/Retailer Management/retailerMarketplaceController')

const router = express.Router()

// Read-only, retailer-safe catalogue shared with approved wholesaler clients.
router.get('/products', marketplaceController.listProducts)
// Constrain :id to a 24-hex Mongo ObjectId so taxonomy paths like
// /products/taxonomy, /products/categories, /products/filters, /products/mine
// are NOT swallowed here and fall through to wholesalerProductRoutes.
router.get('/products/:id([0-9a-fA-F]{24})', marketplaceController.getProduct)

module.exports = router
