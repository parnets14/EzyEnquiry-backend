/**
 * retailerErpRoutes.js
 *
 * ERP modules for the RetailerApp, mounted at /api/retailer/erp/*.
 *
 * ── WHY THIS FILE EXISTS INSTEAD OF REUSING THE EXISTING ROUTE FILES ─────────
 * The generic ERP route files (/api/sales, /api/expenses, …) cannot be reused
 * as-is. Three separate gates reject a retailer token:
 *
 *   1. server.js applies `denyRetailerErpAccess` across every ERP_ROUTE_PREFIXES
 *      entry, which returns 403 for `role === 'Retailer' | 'RetailerStaff'`.
 *   2. Even past that, `moduleAccess(MODULES.X)` resolves permissions from
 *      `RolePermission { company_id, role }` + ROLE_MODULES, which only knows ERP
 *      roles. Retailer roles are absent, so it denies.
 *   3. The route files themselves gate writes with
 *      `allow('Company Owner', 'Manager', …)`, which also excludes retailer roles.
 *
 * So this file re-mounts the SAME controllers behind `requireRetailerModule(key)`
 * instead. Sharing the controllers is safe: every one of them filters
 * exclusively on `req.user.company_id`, and `authenticate` populates that for
 * both the retailer owner and RetailerStaff (see middleware/auth.js). Verified
 * 2026-09-29 — sale/expense/purchase/payment/profitLoss/accounts/warehouse/
 * report controllers have zero wholesaler coupling.
 *
 * `/api/retailer` is deliberately NOT in ERP_ROUTE_PREFIXES, so nothing mounted
 * here is blocked by gate (1).
 *
 * ── PATH SHAPE ───────────────────────────────────────────────────────────────
 * Paths mirror the ERP routes 1:1 (e.g. ERP `GET /api/sales/report` becomes
 * `GET /api/retailer/erp/sales/report`) so the wholesaler app screens port
 * across with only the base path changed in the API layer.
 */
const express = require('express')
const { requireRetailerModule } = require('../../middleware/retailerAccess')
const { validateObjectIdParam } = require('../../middleware/validateObjectId')
const { podUpload } = require('../../middleware/podUpload')
const { uploadDocs } = require('../../middleware/upload')

// ── Controllers (shared with the ERP surface) ────────────────────────────────
const sale       = require('../../controllers/Finance Management/saleController')
const expense    = require('../../controllers/Finance Management/expenseController')
const profitLoss = require('../../controllers/Finance Management/profitLossController')
const payment    = require('../../controllers/Finance Management/paymentController')
const accounts   = require('../../controllers/Finance Management/accountsController')
const purchase   = require('../../controllers/Purchase & Inventory Management/purchaseController')
const supplier   = require('../../controllers/Purchase & Inventory Management/supplierController')
const inventory  = require('../../controllers/Purchase & Inventory Management/inventoryController')
const warehouse  = require('../../controllers/Purchase & Inventory Management/warehouseController')
const transfer   = require('../../controllers/Purchase & Inventory Management/stockTransferController')
const lead       = require('../../controllers/CRM Management/leadController')
const customer   = require('../../controllers/CRM Management/customerController')
const followup   = require('../../controllers/CRM Management/followupController')
const report     = require('../../controllers/Reports Management/reportController')
const dashboard  = require('../../controllers/Retailer Management/retailerDashboardController')
const dispatch   = require('../../controllers/Marketplace Management/dispatchController')
const retailerDispatch = require('../../controllers/Retailer Management/retailerDispatchController')
const document   = require('../../controllers/System Management/documentController')

const router = express.Router()

// Retailers may write their own ERP data — the ERP route files restrict writes to
// Company Owner / Manager / Accountant, which retailer roles never match. Access
// here is controlled per module by requireRetailerModule instead: the owner has
// everything, staff only what their staff_app_access grants.
const gate = (key) => requireRetailerModule(key)

router.param('id', validateObjectIdParam('id'))

/* ══════════════════════════════════════════════════════════════════════════
   DASHBOARD
   Single aggregated payload for the home screen. Replaces the wholesaler's
   five-call fan-out (/reports/dashboard + /enquiries + /inventory/summary +
   /payments/payables + /reports/profit-loss), none of which a retailer token
   can reach. See retailerDashboardController for the scoping notes.
   ══════════════════════════════════════════════════════════════════════════ */
router.get('/dashboard', gate('dashboard'), dashboard.getErpDashboard)

/* ══════════════════════════════════════════════════════════════════════════
   SALES
   ══════════════════════════════════════════════════════════════════════════ */
router.get  ('/sales',              gate('sales'), sale.listSales)
router.get  ('/sales/report',       gate('sales'), sale.salesReport)
router.post ('/sales',              gate('sales'), sale.createSale)
router.get  ('/sales/:id',          gate('sales'), sale.getSale)
router.patch('/sales/:id/payment',  gate('sales'), sale.recordPayment)

/* ══════════════════════════════════════════════════════════════════════════
   EXPENSES
   ══════════════════════════════════════════════════════════════════════════ */
router.get   ('/expenses',     gate('expenses'), expense.listExpenses)
router.post  ('/expenses',     gate('expenses'), expense.createExpense)
router.put   ('/expenses/:id', gate('expenses'), expense.updateExpense)
router.delete('/expenses/:id', gate('expenses'), expense.deleteExpense)

/* ══════════════════════════════════════════════════════════════════════════
   PROFIT & LOSS
   ══════════════════════════════════════════════════════════════════════════ */
router.get('/profit-loss', gate('profit_loss'), profitLoss.getProfitLoss)

/* ══════════════════════════════════════════════════════════════════════════
   PURCHASES + SUPPLIERS
   ══════════════════════════════════════════════════════════════════════════ */
router.get   ('/purchases',                 gate('purchases'), purchase.listPurchases)
router.post  ('/purchases',                 gate('purchases'), purchase.createPurchase)
router.get   ('/purchases/:id',             gate('purchases'), purchase.getPurchase)
router.put   ('/purchases/:id',             gate('purchases'), purchase.updatePurchase)
router.delete('/purchases/:id',             gate('purchases'), purchase.deletePurchase)
router.patch ('/purchases/:id/status',      gate('purchases'), purchase.updatePurchaseStatus)
router.patch ('/purchases/:id/payment',     gate('purchases'), purchase.updatePayment)

router.get   ('/suppliers',      gate('purchases'), supplier.listSuppliers)
router.post  ('/suppliers',      gate('purchases'), supplier.createSupplier)
router.get   ('/suppliers/:id',  gate('purchases'), supplier.getSupplier)
router.put   ('/suppliers/:id',  gate('purchases'), supplier.updateSupplier)
router.delete('/suppliers/:id',  gate('purchases'), supplier.deleteSupplier)

/* ══════════════════════════════════════════════════════════════════════════
   INVENTORY  (static paths before /:id — Express matches in declaration order)
   ══════════════════════════════════════════════════════════════════════════ */
router.get  ('/inventory',                    gate('inventory'), inventory.listInventory)
router.get  ('/inventory/summary',            gate('inventory'), inventory.getInventorySummary)
router.get  ('/inventory/movements',          gate('inventory'), inventory.listMovements)
router.patch('/inventory/adjust',             gate('inventory'), inventory.adjustStock)
router.patch('/inventory/reserve',            gate('inventory'), inventory.reserveStock)
router.patch('/inventory/release-reserve',    gate('inventory'), inventory.releaseReserve)
router.patch('/inventory/start-picking',      gate('inventory'), inventory.startPicking)
router.patch('/inventory/complete-packing',   gate('inventory'), inventory.completePacking)
router.patch('/inventory/dispatch-stock-out', gate('inventory'), inventory.dispatchStockOut)
router.patch('/inventory/block',              gate('inventory'), inventory.blockStock)
router.get  ('/inventory/:id',                gate('inventory'), inventory.getInventoryItem)
router.patch('/inventory/:id/settings',       gate('inventory'), inventory.updateInventorySettings)

/* ══════════════════════════════════════════════════════════════════════════
   WAREHOUSES
   ══════════════════════════════════════════════════════════════════════════ */
router.get   ('/warehouses',            gate('inventory'), warehouse.listWarehouses)
router.post  ('/warehouses',            gate('inventory'), warehouse.createWarehouse)
router.get   ('/warehouses/:id',        gate('inventory'), warehouse.getWarehouse)
router.put   ('/warehouses/:id',        gate('inventory'), warehouse.updateWarehouse)
router.delete('/warehouses/:id',        gate('inventory'), warehouse.deleteWarehouse)
router.get   ('/warehouses/:id/stock',  gate('inventory'), warehouse.getWarehouseStock)

/* ══════════════════════════════════════════════════════════════════════════
   STOCK TRANSFERS
   ══════════════════════════════════════════════════════════════════════════ */
router.get   ('/stock-transfers',           gate('inventory'), transfer.listStockTransfers)
router.post  ('/stock-transfers',           gate('inventory'), transfer.createStockTransfer)
router.get   ('/stock-transfers/:id',       gate('inventory'), transfer.getStockTransfer)
router.patch ('/stock-transfers/:id/status',gate('inventory'), transfer.updateTransferStatus)
router.delete('/stock-transfers/:id',       gate('inventory'), transfer.deleteStockTransfer)

/* ══════════════════════════════════════════════════════════════════════════
   PAYMENTS  (receivable / payable / transactions)
   ══════════════════════════════════════════════════════════════════════════ */
router.get  ('/payments/receivables',   gate('payments'), payment.listReceivables)
router.get  ('/payments/payables',      gate('payments'), payment.listPayables)
router.get  ('/payments/transactions',  gate('payments'), payment.listTransactions)
router.post ('/payments/receivables/:id/collect', gate('payments'), payment.collectReceivable)
router.post ('/payments/payables/:id/pay',        gate('payments'), payment.payPayable)

/* ══════════════════════════════════════════════════════════════════════════
   ACCOUNTS / LEDGERS
   ══════════════════════════════════════════════════════════════════════════ */
router.get('/accounts/company',           gate('accounts'), accounts.getCompanyLedger)
router.get('/accounts/cash-book',         gate('accounts'), accounts.getCashBook)
router.get('/accounts/bank-book',         gate('accounts'), accounts.getBankBook)
router.get('/accounts/customer/:id',      gate('accounts'), accounts.getCustomerLedger)
router.get('/accounts/supplier/:id',      gate('accounts'), accounts.getSupplierLedger)

/* ══════════════════════════════════════════════════════════════════════════
   CRM — LEADS
   ══════════════════════════════════════════════════════════════════════════ */
router.get   ('/leads',            gate('leads'), lead.listLeads)
router.post  ('/leads',            gate('leads'), lead.createLead)
router.put   ('/leads/:id',        gate('leads'), lead.updateLead)
router.patch ('/leads/:id/convert',gate('leads'), lead.convertLead)
router.delete('/leads/:id',        gate('leads'), lead.deleteLead)

/* ══════════════════════════════════════════════════════════════════════════
   CRM — LEAD FOLLOW-UPS (per-lead scheduling, mirrors wholesaler parity)
   ══════════════════════════════════════════════════════════════════════════ */
router.get   ('/followups',          gate('leads'), followup.listFollowups)
router.post  ('/followups',          gate('leads'), followup.createFollowup)
router.put   ('/followups/:id',      gate('leads'), followup.updateFollowup)
router.delete('/followups/:id',      gate('leads'), followup.deleteFollowup)

/* ══════════════════════════════════════════════════════════════════════════
   CRM — CUSTOMERS (ERP-style full CRUD)
   NOTE: /api/retailer/customers already exists for the marketplace flow.
   This is the ERP surface at a distinct path so nothing is shadowed.
   ══════════════════════════════════════════════════════════════════════════ */
router.get   ('/erp-customers',      gate('customers'), customer.listCustomers)
router.post  ('/erp-customers',      gate('customers'), customer.createCustomer)
router.get   ('/erp-customers/:id',  gate('customers'), customer.getCustomer)
router.put   ('/erp-customers/:id',  gate('customers'), customer.updateCustomer)
router.delete('/erp-customers/:id',  gate('customers'), customer.deleteCustomer)

/* ══════════════════════════════════════════════════════════════════════════
   REPORTS
   ══════════════════════════════════════════════════════════════════════════ */
router.get('/reports/sales',      gate('reports'), report.getSalesReport)
router.get('/reports/purchases',  gate('reports'), report.getPurchaseReport)
router.get('/reports/expenses',   gate('reports'), report.getExpenseReport)
router.get('/reports/customers',  gate('reports'), report.getCustomerReport)
router.get('/reports/suppliers',  gate('reports'), report.getSupplierReport)
router.get('/reports/inventory',  gate('reports'), report.getInventoryReport)
router.get('/reports/analytics',  gate('reports'), report.getAnalytics)
router.get('/reports/:type/export', gate('reports'), report.exportReport)

/* ══════════════════════════════════════════════════════════════════════════
   DISPATCH  (wholesaler parity — same controller as /api/dispatches)
   ──────────────────────────────────────────────────────────────────────────
   Dispatch is the final stock-out point for the retailer's own sales flow:
     create  → physical_stock ↓, order → Dispatched
     intransit → order → Out for Delivery
     deliver → Sale + Receivable auto-created
   The shared controller is company-generic (every query is scoped to
   `req.user.company_id`), so re-mounting it here gives the retailer the exact
   same behaviour as the wholesaler without duplicating logic.

   SCOPE: `listDispatches` / `createDispatch` filter on
   `{ company_id: req.user.company_id }`, which for an Order means the SELLER.
   So this surface manages the retailer's OUTBOUND shipments — orders raised
   against products the retailer sells. A retailer's own marketplace purchases
   are dispatched by their seller and stay read-only via
   GET /api/retailer/orders/:id/dispatches (see DispatchDetailsScreen).

   NOTE the ordering: `/dispatches/upload-pod` and
   `/dispatches/dispatchable-orders` are declared before `/dispatches/:id` so
   the static segments always win.
   ══════════════════════════════════════════════════════════════════════════ */
router.get   ('/dispatches',                    gate('dispatches'), dispatch.listDispatches)
router.get   ('/dispatches/dispatchable-orders',gate('dispatches'), retailerDispatch.listDispatchableOrders)
router.post  ('/dispatches/upload-pod',         gate('dispatches'), podUpload, dispatch.uploadPod)
router.post  ('/dispatches',                    gate('dispatches'), dispatch.createDispatch)
router.get   ('/dispatches/:id',                gate('dispatches'), dispatch.getDispatch)
router.patch ('/dispatches/:id/intransit',      gate('dispatches'), dispatch.markInTransit)
router.patch ('/dispatches/:id/deliver',        gate('dispatches'), dispatch.markDelivered)
router.put   ('/dispatches/:id',                gate('dispatches'), dispatch.updateDispatch)

/* ══════════════════════════════════════════════════════════════════════════
   DOCUMENTS  (wholesaler parity — same controller as /api/documents)
   ──────────────────────────────────────────────────────────────────────────
   The wholesaler's Documents screen is a document REPOSITORY (typed uploads,
   filter tabs, list, open, delete) backed by /api/documents. The retailer app
   only had the KYC verification screen, which is a different feature.

   NOTE this is NOT the KYC flow. Retailer KYC lives at
   /api/retailer/kyc/documents (routes/Retailer Management/retailerRoutes.js)
   and writes to the company's `kyc_documents`, which the CRM reviews for
   approval. This repository is free-form: any number of files, tagged with a
   doc_type, kept for the retailer's own reference.

   `documentController` is company-generic — every query filters on
   `{ company_id: req.user.company_id }`, and `uploadDocument` stamps the same
   field — so re-mounting it here needs no wrapper. The uploader is the shared
   `uploadDocs` (middleware/upload.js): array field literally `file`, max 5 per
   request, PDF / image / office / CSV up to MAX_FILE_SIZE_MB (default 10 MB).
   The controller additionally requires `entity_type`; the app sends 'company'.
   ══════════════════════════════════════════════════════════════════════════ */
router.get   ('/documents',     gate('documents'), document.listDocuments)
router.post  ('/documents',     gate('documents'), uploadDocs, document.uploadDocument)
router.delete('/documents/:id', gate('documents'), document.deleteDocument)

module.exports = router
