require('dotenv').config()
require('express-async-errors')

const express     = require('express')
const cors        = require('cors')
const helmet      = require('helmet')
const morgan      = require('morgan')
const compression = require('compression')
const path        = require('path')

// ── Config ───────────────────────────────────────────────────
const connectDB = require('./config/database')
const { MODULES, moduleAccess } = require('./config/permissions')

// ── Utils ────────────────────────────────────────────────────
const { logger }                     = require('./utils/logger')
const { seedSuperAdmin, healOrphanUsers } = require('./utils/seeder')
const { migrateInventoryBuckets }        = require('./utils/migrateInventory')

// ── Middleware ───────────────────────────────────────────────
const { errorHandler }       = require('./middleware/errorHandler')
const { rateLimiter }        = require('./middleware/rateLimiter')
const { authenticate,
        requireCompany,
        requireActiveCompany } = require('./middleware/auth')
const { requireRetailerIdentity,
        requireApprovedSeller,
        denyRetailerErpAccess } = require('./middleware/retailerAccess')
const { auditLogger }        = require('./middleware/auditLogger')

// ── Routes ───────────────────────────────────────────────────
const authRoutes         = require('./routes/authRoutes')
const companyRoutes      = require('./routes/Company Management/companyRoutes')
const branchRoutes       = require('./routes/Company Management/branchRoutes')
const userRoutes         = require('./routes/User Management/userRoutes')
const categoryRoutes     = require('./routes/Product Management/categoryRoutes')
const brandRoutes        = require('./routes/Product Management/brandRoutes')
const productRoutes      = require('./routes/Product Management/productRoutes')
const inventoryRoutes    = require('./routes/Purchase & Inventory Management/inventoryRoutes')
const warehouseRoutes    = require('./routes/Purchase & Inventory Management/warehouseRoutes')
const supplierRoutes     = require('./routes/Purchase & Inventory Management/supplierRoutes')
const enquiryRoutes      = require('./routes/Marketplace Management/enquiryRoutes')
const orderRoutes        = require('./routes/Marketplace Management/orderRoutes')
const dispatchRoutes     = require('./routes/Marketplace Management/dispatchRoutes')
const customerRoutes     = require('./routes/CRM Management/customerRoutes')
const leadRoutes         = require('./routes/CRM Management/leadRoutes')
const followupRoutes     = require('./routes/CRM Management/followupRoutes')
const purchaseRoutes     = require('./routes/Purchase & Inventory Management/purchaseRoutes')
const stockTransferRoutes = require('./routes/Purchase & Inventory Management/stockTransferRoutes')
const salesRoutes        = require('./routes/Finance Management/salesRoutes')
const expenseRoutes      = require('./routes/Finance Management/expenseRoutes')
const paymentRoutes      = require('./routes/Finance Management/paymentRoutes')
const accountsRoutes     = require('./routes/Finance Management/accountsRoutes')
const profitLossRoutes   = require('./routes/Finance Management/profitLossRoutes')
const employeeRoutes        = require('./routes/HR Management/employeeRoutes')
const employeeMasterRoutes  = require('./routes/HR Management/employeeMasterRoutes')
const attendanceRoutes      = require('./routes/HR Management/attendanceRoutes')
const salaryRoutes          = require('./routes/HR Management/salaryRoutes')
const reportRoutes       = require('./routes/Reports Management/reportRoutes')
const dashboardRoutes    = require('./routes/Reports Management/dashboardRoutes')
const notificationRoutes = require('./routes/System Management/notificationRoutes')
const documentRoutes     = require('./routes/System Management/documentRoutes')
const subscriptionRoutes = require('./routes/System Management/subscriptionRoutes')
const profileRoutes      = require('./routes/System Management/profileRoutes')
const rolePermissionRoutes = require('./routes/System Management/rolePermissionRoutes')
const quotationRoutes    = require('./routes/Finance Management/quotationRoutes')
const invoiceRoutes      = require('./routes/Finance Management/invoiceRoutes')
const wholesalerAuthRoutes = require('./routes/Wholesaler Management/wholesalerAuthRoutes')
const wholesalerCatalogRoutes   = require('./routes/Wholesaler Management/wholesalerCatalogRoutes')
const wholesalerProductRoutes   = require('./routes/Wholesaler Management/wholesalerProductRoutes')
const wholesalerInventoryRoutes = require('./routes/Wholesaler Management/wholesalerInventoryRoutes')
const retailerAuthRoutes   = require('./routes/Retailer Management/retailerAuthRoutes')
const retailerRoutes       = require('./routes/Retailer Management/retailerRoutes')
const staffAuthRoutes      = require('./routes/Staff App Management/staffAuthRoutes')
const staffDataRoutes      = require('./routes/Staff App Management/staffDataRoutes')

// ────────────────────────────────────────────────────────────
const app  = express()
const PORT = process.env.PORT || 5000

// ── Security & Utility Middleware ────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
app.use(compression())
// In development: allow ALL origins so any phone/emulator on the LAN can connect.
// In production: restrict to your actual frontend domain via FRONTEND_URL env var.
const corsOrigin = process.env.NODE_ENV === 'production'
  ? (process.env.FRONTEND_URL || 'https://your-domain.com')
  : true // true = reflect any origin — safe for local dev

app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    'http://localhost:3000',
    'http://10.67.41.163:5173',   // frontend on this machine
    'http://10.67.41.163',        // mobile device
    'http://10.67.41.163:8081',   // React Native Metro dev server on device
    'http://192.168.1.8',         // alternate device IP
    'http://192.168.1.8:8081',
    'http://192.168.1.45',        // this machine (Wi-Fi) — retailer device
    'http://192.168.1.45:5173',
    'http://192.168.1.45:5000',
    'http://192.168.1.45:8081',   // Metro dev server on device
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// ── Static Files ─────────────────────────────────────────────
// KYC files are available only through authenticated retailer download routes.
app.use('/uploads/kyc', (_req, res) => {
  res.status(404).json({ success: false, message: 'File not found.' })
})
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')))

// ── Rate Limiter ─────────────────────────────────────────────
app.use('/api/', rateLimiter)

// ── Health Check ─────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'EzyEnquiry API' })
})

// ── One-time inventory migration endpoint (dev only) ─────────
// Hit GET /migrate-inventory from any browser tab to run the backfill.
// Remove this route after the migration has been confirmed.
app.get('/migrate-inventory', async (_req, res) => {
  try {
    const { migrateInventoryBuckets } = require('./utils/migrateInventory')
    await migrateInventoryBuckets()
    const Inventory = require('./models/Purchase & Inventory Management/Inventory')
    const all = await Inventory.find({}).select('product_id current_stock available_stock physical_stock company_id').lean()
    res.json({ success: true, message: 'Migration complete', records: all })
  } catch (err) {
    res.status(500).json({ success: false, message: err.message })
  }
})

// ── Public KYC document viewer (token-signed, no auth header) ─
// The signed token in the query string is the authorization; must be
// registered BEFORE the authenticated /api/companies block below.
const { viewCompanyDocument } = require('./controllers/Company Management/companyDocumentController')
app.get('/api/companies/documents/view', viewCompanyDocument)

// ── Public Routes ─────────────────────────────────────────────
app.use('/api/auth',              authRoutes)
app.use('/api/auth/staff',        staffAuthRoutes)
// Staff App data (company-scoped Sales Orders + Invoices + record payment).
app.use('/api/staff',             authenticate, requireCompany, staffDataRoutes)
app.use('/api/wholesaler/auth',   wholesalerAuthRoutes)
app.use('/api/wholesaler',        authenticate, requireApprovedSeller, wholesalerCatalogRoutes)
app.use('/api/retailer/auth',     retailerAuthRoutes)
app.use('/api/retailer',          authenticate, requireRetailerIdentity, retailerRoutes)

// Retailer identities must use the dedicated API and cannot enter ERP/admin modules.
const ERP_ROUTE_PREFIXES = [
  '/api/companies', '/api/branches', '/api/users',
  '/api/categories', '/api/sub-categories', '/api/brands', '/api/products',
  '/api/inventory', '/api/warehouses', '/api/suppliers',
  '/api/enquiries', '/api/orders', '/api/dispatches',
  '/api/customers', '/api/leads', '/api/followups',
  '/api/purchases', '/api/stock-transfers', '/api/sales', '/api/expenses',
  '/api/payments', '/api/accounts', '/api/profit-loss', '/api/quotations', '/api/invoices',
  '/api/employees', '/api/employee-master', '/api/attendance', '/api/salary',
  '/api/reports', '/api/notifications', '/api/documents', '/api/subscriptions', '/api/profile',
]
app.use(ERP_ROUTE_PREFIXES, authenticate, denyRetailerErpAccess, auditLogger)

// ── Wholesaler Protected Routes ───────────────────────────────
app.use('/api/wholesaler/products',   authenticate, requireActiveCompany, wholesalerProductRoutes)
app.use('/api/wholesaler/inventory',  authenticate, requireActiveCompany, wholesalerInventoryRoutes)
app.use('/api/wholesaler/warehouses', authenticate, requireActiveCompany, require('./routes/Wholesaler Management/wholesalerWarehouseRoutes'))
app.use('/api/wholesaler/purchases',  authenticate, requireActiveCompany, require('./routes/Wholesaler Management/wholesalerPurchaseRoutes'))
app.use('/api/wholesaler/all-purchases', authenticate, require('./routes/Wholesaler Management/wholesalerAdminRoutes'))
app.use('/api/wholesaler/quotations',    authenticate, requireActiveCompany, require('./routes/Wholesaler Management/wholesalerQuotationRoutes'))
app.use('/api/wholesaler/all-quotations', authenticate, require('./routes/Wholesaler Management/wholesalerAdminQuotationRoutes'))
app.use('/api/wholesaler/all-products',   authenticate, require('./routes/Wholesaler Management/wholesalerAdminProductRoutes'))
app.use('/api/wholesaler/invoices',       authenticate, requireActiveCompany, require('./routes/Wholesaler Management/wholesalerInvoiceRoutes'))

// ── Protected Routes ──────────────────────────────────────────
app.use('/api/companies',     authenticate, moduleAccess(MODULES.COMPANY), companyRoutes)
app.use('/api/companies',     authenticate, moduleAccess(MODULES.BRANCH), branchRoutes)   // /api/companies/:companyId/branches
app.use('/api/branches',      authenticate, requireCompany, moduleAccess(MODULES.BRANCH), branchRoutes) // standalone branch access
app.use('/api/users',         authenticate, requireCompany, moduleAccess(MODULES.USERS), userRoutes)

// ── Product & Inventory ───────────────────────────────────────
app.use('/api/categories',     authenticate, requireCompany, moduleAccess(MODULES.CATEGORIES), categoryRoutes)
app.use('/api/sub-categories', authenticate, requireCompany, moduleAccess(MODULES.CATEGORIES), require('./routes/Product Management/subCategoryRoutes'))
app.use('/api/brands',         authenticate, requireCompany, moduleAccess(MODULES.BRANDS), brandRoutes)
app.use('/api/products',       authenticate, requireCompany, moduleAccess(MODULES.PRODUCTS), productRoutes)
app.use('/api/inventory',      authenticate, requireCompany, moduleAccess(MODULES.INVENTORY), inventoryRoutes)
app.use('/api/warehouses',     authenticate, requireCompany, moduleAccess(MODULES.WAREHOUSES), warehouseRoutes)
app.use('/api/suppliers',      authenticate, requireCompany, moduleAccess(MODULES.SUPPLIERS), supplierRoutes)

// ── Marketplace ───────────────────────────────────────────────
app.use('/api/enquiries',     authenticate, requireCompany, requireActiveCompany, moduleAccess(MODULES.ENQUIRIES), enquiryRoutes)
app.use('/api/orders',        authenticate, requireCompany, requireActiveCompany, moduleAccess(MODULES.ORDERS), orderRoutes)
app.use('/api/dispatches',    authenticate, requireCompany, requireActiveCompany, moduleAccess(MODULES.DISPATCHES), dispatchRoutes)

// ── CRM ───────────────────────────────────────────────────────
app.use('/api/customers',     authenticate, requireCompany, requireActiveCompany, moduleAccess(MODULES.CUSTOMERS), customerRoutes)
app.use('/api/leads',         authenticate, requireCompany, requireActiveCompany, moduleAccess(MODULES.LEADS), leadRoutes)
app.use('/api/followups',     authenticate, requireCompany, requireActiveCompany, moduleAccess(MODULES.FOLLOWUPS), followupRoutes)

// ── Finance ───────────────────────────────────────────────────
app.use('/api/purchases',     authenticate, requireCompany, requireActiveCompany, moduleAccess(MODULES.PURCHASES), purchaseRoutes)
app.use('/api/stock-transfers', authenticate, requireCompany, requireActiveCompany, moduleAccess(MODULES.STOCK_TRANSFER), stockTransferRoutes)
app.use('/api/sales',         authenticate, requireCompany, requireActiveCompany, moduleAccess(MODULES.SALES), salesRoutes)
app.use('/api/expenses',      authenticate, requireCompany, requireActiveCompany, moduleAccess(MODULES.EXPENSES), expenseRoutes)
app.use('/api/payments',      authenticate, requireCompany, requireActiveCompany, moduleAccess(MODULES.PAYMENTS), paymentRoutes)
app.use('/api/accounts',      authenticate, requireCompany, requireActiveCompany, moduleAccess(MODULES.ACCOUNTS), accountsRoutes)
app.use('/api/profit-loss',   authenticate, requireCompany, requireActiveCompany, moduleAccess(MODULES.PROFIT_LOSS), profitLossRoutes)
app.use('/api/quotations',    authenticate, requireCompany, requireActiveCompany, moduleAccess(MODULES.QUOTATIONS), quotationRoutes)
app.use('/api/invoices',      authenticate, requireCompany, requireActiveCompany, moduleAccess(MODULES.INVOICES), invoiceRoutes)

// ── HR ────────────────────────────────────────────────────────
app.use('/api/employees',        authenticate, requireCompany, moduleAccess(MODULES.EMPLOYEES), employeeRoutes)
app.use('/api/employee-master',  authenticate, requireCompany, moduleAccess(MODULES.EMPLOYEE_MASTER), employeeMasterRoutes)
app.use('/api/attendance',       authenticate, requireCompany, moduleAccess(MODULES.ATTENDANCE), attendanceRoutes)
app.use('/api/salary',           authenticate, requireCompany, moduleAccess(MODULES.SALARY), salaryRoutes)

// ── Reports & Analytics ───────────────────────────────────────
app.use('/api/reports/dashboard', authenticate, requireCompany, moduleAccess(MODULES.DASHBOARD), dashboardRoutes)
app.use('/api/reports',           authenticate, requireCompany, moduleAccess(MODULES.REPORTS), reportRoutes)

// ── System ────────────────────────────────────────────────────
app.use('/api/notifications', authenticate, requireCompany, moduleAccess(MODULES.NOTIFICATIONS), notificationRoutes)
app.use('/api/documents',     authenticate, requireCompany, moduleAccess(MODULES.DOCUMENTS), documentRoutes)
app.use('/api/subscriptions', authenticate, requireCompany, moduleAccess(MODULES.SUBSCRIPTIONS), subscriptionRoutes)
app.use('/api/profile',       authenticate, moduleAccess(MODULES.PROFILE), profileRoutes)
app.use('/api/role-permissions', authenticate, requireCompany, rolePermissionRoutes)

// ── 404 Handler ───────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` })
})

// ── Global Error Handler ──────────────────────────────────────
app.use(errorHandler)

// ── Connect DB → Start Server ─────────────────────────────────
connectDB().then(async () => {
  await seedSuperAdmin()
  await healOrphanUsers()
  await migrateInventoryBuckets()   // backfill physical_stock/available_stock on legacy records

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✓ Server running on http://0.0.0.0:${PORT} [${process.env.NODE_ENV || 'development'}]`)
  })
})

module.exports = app
