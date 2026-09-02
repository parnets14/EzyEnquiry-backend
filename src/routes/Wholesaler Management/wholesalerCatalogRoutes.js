const express = require('express')
const marketplaceController = require('../../controllers/Retailer Management/retailerMarketplaceController')

const router = express.Router()

// Read-only, retailer-safe catalogue shared with approved wholesaler clients.
router.get('/products', marketplaceController.listProducts)
router.get('/products/:id', marketplaceController.getProduct)

module.exports = router
