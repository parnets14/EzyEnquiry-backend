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

// ── Utils ────────────────────────────────────────────────────
const { logger }                     = require('./utils/logger')
const { seedSuperAdmin, healOrphanUsers } = require('./utils/seeder')

// ── Middleware ───────────────────────────────────────────────
const { errorHandler }       = require('./middleware/errorHandler')
const { rateLimiter }        = require('./middleware/rateLimiter')
const { authenticate,
        requireCompany }     = require('./middleware/auth')

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
const quotationRoutes    = require('./routes/Finance Management/quotationRoutes')
const invoiceRoutes      = require('./routes/Finance Management/invoiceRoutes')
const wholesalerAuthRoutes      = require('./routes/Wholesaler Management/wholesalerAuthRoutes')
const wholesalerProductRoutes   = require('./routes/Wholesaler Management/wholesalerProductRoutes')
const wholesalerInventoryRoutes = require('./routes/Wholesaler Management/wholesalerInventoryRoutes')

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
  origin: corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// ── Static Files ─────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')))

// ── Rate Limiter ─────────────────────────────────────────────
app.use('/api/', rateLimiter)

// ── Health Check ─────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'EzyEnquiry API' })
})

// ── Public Routes ─────────────────────────────────────────────
app.use('/api/auth',              authRoutes)
app.use('/api/wholesaler/auth',   wholesalerAuthRoutes)

// ── Wholesaler Protected Routes ───────────────────────────────
app.use('/api/wholesaler/products',   authenticate, wholesalerProductRoutes)
app.use('/api/wholesaler/inventory',  authenticate, wholesalerInventoryRoutes)
app.use('/api/wholesaler/warehouses', authenticate, require('./routes/Wholesaler Management/wholesalerWarehouseRoutes'))

// ── Protected Routes ──────────────────────────────────────────
app.use('/api/companies',     authenticate, companyRoutes)
app.use('/api/companies',     authenticate, branchRoutes)   // /api/companies/:companyId/branches
app.use('/api/branches',      authenticate, requireCompany, branchRoutes) // standalone branch access
app.use('/api/users',         authenticate, requireCompany, userRoutes)

// ── Product & Inventory ───────────────────────────────────────
app.use('/api/categories',     authenticate, requireCompany, categoryRoutes)
app.use('/api/sub-categories', authenticate, requireCompany, require('./routes/Product Management/subCategoryRoutes'))
app.use('/api/brands',         authenticate, requireCompany, brandRoutes)
app.use('/api/products',       authenticate, requireCompany, productRoutes)
app.use('/api/inventory',      authenticate, requireCompany, inventoryRoutes)
app.use('/api/warehouses',     authenticate, requireCompany, warehouseRoutes)
app.use('/api/suppliers',      authenticate, requireCompany, supplierRoutes)

// ── Marketplace ───────────────────────────────────────────────
app.use('/api/enquiries',     authenticate, requireCompany, enquiryRoutes)
app.use('/api/orders',        authenticate, requireCompany, orderRoutes)
app.use('/api/dispatches',    authenticate, requireCompany, dispatchRoutes)

// ── CRM ───────────────────────────────────────────────────────
app.use('/api/customers',     authenticate, requireCompany, customerRoutes)
app.use('/api/leads',         authenticate, requireCompany, leadRoutes)
app.use('/api/followups',     authenticate, requireCompany, followupRoutes)

// ── Finance ───────────────────────────────────────────────────
app.use('/api/purchases',     authenticate, requireCompany, purchaseRoutes)
app.use('/api/stock-transfers', authenticate, requireCompany, stockTransferRoutes)
app.use('/api/sales',         authenticate, requireCompany, salesRoutes)
app.use('/api/expenses',      authenticate, requireCompany, expenseRoutes)
app.use('/api/payments',      authenticate, requireCompany, paymentRoutes)
app.use('/api/accounts',      authenticate, requireCompany, accountsRoutes)
app.use('/api/profit-loss',   authenticate, requireCompany, profitLossRoutes)
app.use('/api/quotations',    authenticate, requireCompany, quotationRoutes)
app.use('/api/invoices',      authenticate, requireCompany, invoiceRoutes)

// ── HR ────────────────────────────────────────────────────────
app.use('/api/employees',        authenticate, requireCompany, employeeRoutes)
app.use('/api/employee-master',  authenticate, requireCompany, employeeMasterRoutes)
app.use('/api/attendance',       authenticate, requireCompany, attendanceRoutes)
app.use('/api/salary',           authenticate, requireCompany, salaryRoutes)

// ── Reports & Analytics ───────────────────────────────────────
app.use('/api/reports/dashboard', authenticate, requireCompany, dashboardRoutes)
app.use('/api/reports',           authenticate, requireCompany, reportRoutes)

// ── System ────────────────────────────────────────────────────
app.use('/api/notifications', authenticate, requireCompany, notificationRoutes)
app.use('/api/documents',     authenticate, requireCompany, documentRoutes)
app.use('/api/subscriptions', authenticate, requireCompany, subscriptionRoutes)
app.use('/api/profile',       authenticate, profileRoutes)

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

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`✓ Server running on http://0.0.0.0:${PORT} [${process.env.NODE_ENV || 'development'}]`)
  })
})

module.exports = app
