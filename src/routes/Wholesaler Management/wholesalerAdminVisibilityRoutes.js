/**
 * Wholesaler Admin — Cross-company visibility routes (Super Admin)
 * Each mounted separately in server.js:
 *   /api/wholesaler/all-orders
 *   /api/wholesaler/all-enquiries
 *   /api/wholesaler/all-users
 *   /api/wholesaler/all-transactions
 */
const express = require('express')
const ctrl    = require('../../controllers/Wholesaler Management/wholesalerAdminVisibilityController')

const orders       = express.Router(); orders.get('/', ctrl.listAllOrders)
const enquiries    = express.Router(); enquiries.get('/', ctrl.listAllEnquiries)
const users        = express.Router(); users.get('/', ctrl.listAllUsers)
const transactions = express.Router(); transactions.get('/', ctrl.listAllTransactions)
const leads        = express.Router(); leads.get('/', ctrl.listAllLeads)
const followups    = express.Router(); followups.get('/', ctrl.listAllFollowups)
const customers    = express.Router(); customers.get('/', ctrl.listAllCustomers)

module.exports = { orders, enquiries, users, transactions, leads, followups, customers }
