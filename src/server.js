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
const { logger } = require('./utils/logger')

// ── Middleware ───────────────────────────────────────────────
const { errorHandler }           = require('./middleware/errorHandler')
const { rateLimiter,
        authRateLimiter }        = require('./middleware/rateLimiter')
const { authenticate,
        requireCompany }         = require('./middleware/auth')

// ── Routes ───────────────────────────────────────────────────
const authRoutes         = require('./routes/authRoutes')
const companyRoutes      = require('./routes/companyRoutes')
const userRoutes         = require('./routes/userRoutes')
const categoryRoutes     = require('./routes/categoryRoutes')
const brandRoutes        = require('./routes/brandRoutes')
const productRoutes      = require('./routes/productRoutes')
const inventoryRoutes    = require('./routes/inventoryRoutes')
const enquiryRoutes      = require('./routes/enquiryRoutes')
const orderRoutes        = require('./routes/orderRoutes')
const dispatchRoutes     = require('./routes/dispatchRoutes')
const customerRoutes     = require('./routes/customerRoutes')
const leadRoutes         = require('./routes/leadRoutes')
const followupRoutes     = require('./routes/followupRoutes')
const purchaseRoutes     = require('./routes/purchaseRoutes')
const salesRoutes        = require('./routes/salesRoutes')
const expenseRoutes      = require('./routes/expenseRoutes')
const paymentRoutes      = require('./routes/paymentRoutes')
const employeeRoutes     = require('./routes/employeeRoutes')
const reportRoutes       = require('./routes/reportRoutes')
const notificationRoutes = require('./routes/notificationRoutes')
const documentRoutes     = require('./routes/documentRoutes')
const subscriptionRoutes = require('./routes/subscriptionRoutes')
const quotationRoutes    = require('./routes/quotationRoutes')

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
  ],
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

// ── Public Routes (no auth required) ─────────────────────────
app.use('/api/auth', authRoutes)

// ── Protected Routes (auth required) ─────────────────────────
app.use('/api/companies',     authenticate, companyRoutes)
app.use('/api/users',         authenticate, requireCompany, userRoutes)

// ── Product & Inventory ──────────────────────────────────────
app.use('/api/categories',     authenticate, requireCompany, categoryRoutes)
app.use('/api/sub-categories', authenticate, requireCompany, require('./routes/subCategoryRoutes'))
app.use('/api/brands',         authenticate, requireCompany, brandRoutes)
app.use('/api/products',       authenticate, requireCompany, productRoutes)
app.use('/api/inventory',      authenticate, requireCompany, inventoryRoutes)

// ── Marketplace ──────────────────────────────────────────────
app.use('/api/enquiries',     authenticate, requireCompany, enquiryRoutes)
app.use('/api/orders',        authenticate, requireCompany, orderRoutes)
app.use('/api/dispatches',    authenticate, requireCompany, dispatchRoutes)

// ── CRM ──────────────────────────────────────────────────────
app.use('/api/customers',     authenticate, requireCompany, customerRoutes)
app.use('/api/leads',         authenticate, requireCompany, leadRoutes)
app.use('/api/followups',     authenticate, requireCompany, followupRoutes)

// ── Finance ──────────────────────────────────────────────────
app.use('/api/purchases',     authenticate, requireCompany, purchaseRoutes)
app.use('/api/sales',         authenticate, requireCompany, salesRoutes)
app.use('/api/expenses',      authenticate, requireCompany, expenseRoutes)
app.use('/api/payments',      authenticate, requireCompany, paymentRoutes)
app.use('/api/quotations',    authenticate, requireCompany, quotationRoutes)

// ── HR ───────────────────────────────────────────────────────
app.use('/api/employees',     authenticate, requireCompany, employeeRoutes)

// ── Reports & Analytics ──────────────────────────────────────
app.use('/api/reports',       authenticate, requireCompany, reportRoutes)

// ── System ───────────────────────────────────────────────────
app.use('/api/notifications', authenticate, requireCompany, notificationRoutes)
app.use('/api/documents',     authenticate, requireCompany, documentRoutes)
app.use('/api/subscriptions', authenticate, requireCompany, subscriptionRoutes)

// ── 404 Handler ──────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` })
})

// ── Global Error Handler ─────────────────────────────────────
app.use(errorHandler)

// ── Connect DB → Start Server ─────────────────────────────────
connectDB().then(async () => {
  // ── Seed Super Admin + default company on first boot ────────
  await seedSuperAdmin()
  // ── Heal any users with missing company_id ───────────────────
  await healOrphanUsers()

  app.listen(PORT, () => {
    console.log(`✓ Server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`)
  })
})

/**
 * Creates the Super Admin user if one does not already exist,
 * and seeds a default company for them to use immediately.
 * Credentials come from .env: SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD
 */
async function seedSuperAdmin() {
  try {
    const bcrypt         = require('bcryptjs')
    const { UserModel }  = require('./models/User')
    const { CompanyModel } = require('./models/Company')

    const email = process.env.SUPER_ADMIN_EMAIL || 'ezyenquiry@gmail.com'
    const existing = await UserModel.findOne({ email }).lean()

    if (existing) {
      // If the Super Admin exists but has no company_id, assign the default company
      if (!existing.company_id) {
        let company = await CompanyModel.findOne({}).sort({ created_at: 1 }).lean()
        if (!company) {
          company = await CompanyModel.create({
            company_code:      'COM-001',
            name:              process.env.SUPER_ADMIN_COMPANY_NAME || 'EzyEnquiry Pvt Ltd',
            owner_name:        process.env.SUPER_ADMIN_NAME         || 'Super Admin',
            biz_type:          'Wholesaler',
            mobile:            '9000000000',
            email:             email,
            subscription_plan: 'Platinum',
            status:            'Approved',
          })
          console.log('[Seed] ✓ Default company created — EzyEnquiry Pvt Ltd')
        }
        await UserModel.findByIdAndUpdate(existing._id, { company_id: company._id })
        console.log('[Seed] ✓ Super Admin linked to company —', company.name)
      } else {
        console.log('[Seed] Super Admin already exists — skipping.')
      }
      return
    }

    // ── Ensure default company exists ─────────────────────────
    let company = await CompanyModel.findOne({}).sort({ created_at: 1 }).lean()
    if (!company) {
      company = await CompanyModel.create({
        company_code:      'COM-001',
        name:              process.env.SUPER_ADMIN_COMPANY_NAME || 'EzyEnquiry Pvt Ltd',
        owner_name:        process.env.SUPER_ADMIN_NAME         || 'Super Admin',
        biz_type:          'Wholesaler',
        mobile:            '9000000000',
        email:             email,
        subscription_plan: 'Platinum',
        status:            'Approved',
      })
      console.log('[Seed] ✓ Default company created — EzyEnquiry Pvt Ltd')
    }

    // ── Create Super Admin user linked to company ─────────────
    const password = process.env.SUPER_ADMIN_PASSWORD || 'ezyenquiry@123'
    const hash     = await bcrypt.hash(password, 12)

    await UserModel.create({
      name:          process.env.SUPER_ADMIN_NAME || 'Super Admin',
      email,
      mobile:        '9000000000',
      password_hash: hash,
      role:          'Super Admin',
      company_id:    company._id,
      is_active:     true,
    })
    console.log(`[Seed] ✓ Super Admin created — ${email}`)
  } catch (err) {
    console.error('[Seed] ✗ Failed to seed Super Admin:', err.message)
  }
}

/**
 * Assigns a company_id to any user record that is missing one.
 * Runs on every boot — safe to run multiple times (idempotent).
 * This heals users that were created before company association was enforced.
 */
async function healOrphanUsers() {
  try {
    const { UserModel }    = require('./models/User')
    const { CompanyModel } = require('./models/Company')

    // Find the first (oldest) company to use as the default fallback
    const company = await CompanyModel.findOne({}).sort({ created_at: 1 }).lean()
    if (!company) return // No company yet — nothing to heal

    // Fix users with missing or null company_id
    const r1 = await UserModel.updateMany(
      { company_id: { $exists: false } },
      { $set: { company_id: company._id } }
    )
    const r2 = await UserModel.updateMany(
      { company_id: null },
      { $set: { company_id: company._id } }
    )
    const total = r1.modifiedCount + r2.modifiedCount
    if (total > 0) {
      console.log(`[Heal] ✓ Linked ${total} orphan user(s) to company "${company.name}"`)
    }
  } catch (err) {
    console.error('[Heal] ✗ Failed to heal orphan users:', err.message)
  }
}

module.exports = app
