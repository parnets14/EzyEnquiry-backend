const express = require('express')
const { authenticate, requireCompany } = require('../middleware/auth')

const router = express.Router()

// ── Auth routes (no auth required) ──────────────────────────
router.use('/auth', require('./authRoutes'))

// ── All following routes require authentication ─────────────
router.use(authenticate)

// ── Company management ──────────────────────────────────────
router.use('/companies', require('./companyRoutes'))

// ── User management ─────────────────────────────────────────
router.use('/users', requireCompany, require('./userRoutes'))

// ── Product & Inventory ─────────────────────────────────────
router.use('/categories',     requireCompany, require('./categoryRoutes'))
router.use('/sub-categories', requireCompany, require('./subCategoryRoutes'))
router.use('/brands',         requireCompany, require('./brandRoutes'))
router.use('/products',       requireCompany, require('./productRoutes'))
router.use('/inventory',      requireCompany, require('./inventoryRoutes'))

// ── Marketplace ─────────────────────────────────────────────
router.use('/enquiries',  requireCompany, require('./enquiryRoutes'))
router.use('/orders',     requireCompany, require('./orderRoutes'))
router.use('/dispatches', requireCompany, require('./dispatchRoutes'))

// ── CRM & Sales ─────────────────────────────────────────────
router.use('/customers',  requireCompany, require('./customerRoutes'))
router.use('/leads',      requireCompany, require('./leadRoutes'))
router.use('/followups',  requireCompany, require('./followupRoutes'))

// ── Finance ─────────────────────────────────────────────────
router.use('/purchases',  requireCompany, require('./purchaseRoutes'))
router.use('/sales',      requireCompany, require('./salesRoutes'))
router.use('/expenses',   requireCompany, require('./expenseRoutes'))
router.use('/payments',   requireCompany, require('./paymentRoutes'))

// ── HR ──────────────────────────────────────────────────────
router.use('/employees',  requireCompany, require('./employeeRoutes'))

// ── Reports & Analytics ─────────────────────────────────────
router.use('/reports',    requireCompany, require('./reportRoutes'))

// ── System ──────────────────────────────────────────────────
router.use('/notifications', requireCompany, require('./notificationRoutes'))
router.use('/documents',     requireCompany, require('./documentRoutes'))
router.use('/subscriptions', requireCompany, require('./subscriptionRoutes'))

module.exports = router
