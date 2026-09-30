/**
 * Retailer Admin — Cross-company data visibility routes (Super Admin)
 *
 * Each router is mounted separately in server.js so the URL prefix stays flat
 * and readable:
 *   /api/retailer/admin/users        /api/retailer/admin/orders
 *   /api/retailer/admin/enquiries    /api/retailer/admin/products
 *   /api/retailer/admin/sales        /api/retailer/admin/purchases
 *   /api/retailer/admin/expenses     /api/retailer/admin/transactions
 *   /api/retailer/admin/invoices     /api/retailer/admin/quotations
 *   /api/retailer/admin/customers    /api/retailer/admin/leads
 *   /api/retailer/admin/followups    /api/retailer/admin/inventory
 *   /api/retailer/admin/dispatches   /api/retailer/admin/activity-summary
 *
 * These are mounted BEFORE the retailer identity guard in server.js, because a
 * Super Admin token is not a retailer identity and would otherwise be rejected.
 * `/api/retailer/admin/*` is intentionally NOT in ERP_ROUTE_PREFIXES.
 */
const express = require('express')
const ctrl    = require('../../controllers/Retailer Management/retailerAdminVisibilityController')

const one = fn => { const r = express.Router(); r.get('/', fn); return r }

const users       = one(ctrl.listUsers)
const orders      = one(ctrl.listOrders)
const enquiries   = one(ctrl.listEnquiries)
const products    = one(ctrl.listProducts)

// ── ERP data the retailer app produces ───────────────────────────────────────
const sales        = one(ctrl.listSales)
const purchases    = one(ctrl.listPurchases)
const expenses     = one(ctrl.listExpenses)
const transactions = one(ctrl.listTransactions)
const invoices     = one(ctrl.listInvoices)
const quotations   = one(ctrl.listQuotations)

// ── CRM data ────────────────────────────────────────────────────────────────
const customers = one(ctrl.listCustomers)
const leads     = one(ctrl.listLeads)
const followups = one(ctrl.listFollowups)

// ── Stock & logistics ───────────────────────────────────────────────────────
const inventory  = one(ctrl.listInventory)
const dispatches = one(ctrl.listDispatches)

// ── Aggregated overview ─────────────────────────────────────────────────────
const summary = one(ctrl.getActivitySummary)

module.exports = {
  users, orders, enquiries, products,
  sales, purchases, expenses, transactions, invoices, quotations,
  customers, leads, followups,
  inventory, dispatches,
  summary,
}
