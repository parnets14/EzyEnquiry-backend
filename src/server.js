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

// ── Middleware ───────────────────────────────────────────────
const { errorHandler }       = require('./middleware/errorHandler')
const { rateLimiter }        = require('./middleware/rateLimiter')
const { authenticate,
        requireCompany }     = require('./middleware/auth')
const { requireRetailerIdentity,
        requireApprovedSeller,
        denyRetailerErpAccess } = require('./middleware/retailerAccess')

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
const wholesalerAuthRoutes    = require('./routes/Wholesaler Management/wholesalerAuthRoutes')
const wholesalerCatalogRoutes = require('./routes/Wholesaler Management/wholesalerCatalogRoutes')
const retailerAuthRoutes   = require('./routes/Retailer Management/retailerAuthRoutes')
const retailerRoutes       = require('./routes/Retailer Management/retailerRoutes')
const staffAuthRoutes      = require('./routes/Staff App Management/staffAuthRoutes')

// ────────────────────────────────────────────────────────────
const app  = express()
const PORT = process.env.PORT || 5000

// ── Security & Utility Middleware ────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
app.use(compression())
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

// ── Public Routes ─────────────────────────────────────────────
app.use('/api/auth',              authRoutes)
app.use('/api/auth/staff',        staffAuthRoutes)
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
  '/api/role-permissions',
]
app.use(ERP_ROUTE_PREFIXES, authenticate, denyRetailerErpAccess)

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
app.use('/api/enquiries',     authenticate, requireCompany, moduleAccess(MODULES.ENQUIRIES), enquiryRoutes)
app.use('/api/orders',        authenticate, requireCompany, moduleAccess(MODULES.ORDERS), orderRoutes)
app.use('/api/dispatches',    authenticate, requireCompany, moduleAccess(MODULES.DISPATCHES), dispatchRoutes)

// ── CRM ───────────────────────────────────────────────────────
app.use('/api/customers',     authenticate, requireCompany, moduleAccess(MODULES.CUSTOMERS), customerRoutes)
app.use('/api/leads',         authenticate, requireCompany, moduleAccess(MODULES.LEADS), leadRoutes)
app.use('/api/followups',     authenticate, requireCompany, moduleAccess(MODULES.FOLLOWUPS), followupRoutes)

// ── Finance ───────────────────────────────────────────────────
app.use('/api/purchases',     authenticate, requireCompany, moduleAccess(MODULES.PURCHASES), purchaseRoutes)
app.use('/api/stock-transfers', authenticate, requireCompany, moduleAccess(MODULES.STOCK_TRANSFER), stockTransferRoutes)
app.use('/api/sales',         authenticate, requireCompany, moduleAccess(MODULES.SALES), salesRoutes)
app.use('/api/expenses',      authenticate, requireCompany, moduleAccess(MODULES.EXPENSES), expenseRoutes)
app.use('/api/payments',      authenticate, requireCompany, moduleAccess(MODULES.PAYMENTS), paymentRoutes)
app.use('/api/accounts',      authenticate, requireCompany, moduleAccess(MODULES.ACCOUNTS), accountsRoutes)
app.use('/api/profit-loss',   authenticate, requireCompany, moduleAccess(MODULES.PROFIT_LOSS), profitLossRoutes)
app.use('/api/quotations',    authenticate, requireCompany, moduleAccess(MODULES.QUOTATIONS), quotationRoutes)
app.use('/api/invoices',      authenticate, requireCompany, moduleAccess(MODULES.INVOICES), invoiceRoutes)

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
app.use('/api/profile',       authenticate, profileRoutes)
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

  app.listen(PORT, () => {
    console.log(`✓ Server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`)
  })
})

module.exports = app
