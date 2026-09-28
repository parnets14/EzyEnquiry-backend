/**
 * Retailer Admin — Cross-company data visibility routes (Super Admin)
 * Each mounted separately in server.js:
 *   /api/retailer/admin/users
 *   /api/retailer/admin/orders
 *   /api/retailer/admin/enquiries
 *   /api/retailer/admin/products
 */
const express = require('express')
const ctrl    = require('../../controllers/Retailer Management/retailerAdminVisibilityController')

const users     = express.Router(); users.get('/',     ctrl.listUsers)
const orders    = express.Router(); orders.get('/',    ctrl.listOrders)
const enquiries = express.Router(); enquiries.get('/', ctrl.listEnquiries)
const products  = express.Router(); products.get('/',  ctrl.listProducts)

module.exports = { users, orders, enquiries, products }
