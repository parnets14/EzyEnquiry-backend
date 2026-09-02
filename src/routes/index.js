const express = require('express');
const { authenticate, requireCompany } = require('../middleware/auth');

const router = express.Router();

// ── Auth (no auth required) ──────────────────────────────────
router.use('/auth', require('./authRoutes'));

// ── Staff App auth (no auth required) ────────────────────────
router.use('/auth/staff', require('./Staff App Management/staffAuthRoutes'));

// ── All routes below require authentication ──────────────────
router.use(authenticate);

// ── Company Management ───────────────────────────────────────
router.use('/companies', require('./Company Management/companyRoutes'));

// ── User Management ──────────────────────────────────────────
router.use('/users', requireCompany, require('./User Management/userRoutes'));

// ── Product Management ───────────────────────────────────────
router.use('/categories',     requireCompany, require('./Product Management/categoryRoutes'));
router.use('/sub-categories', requireCompany, require('./Product Management/subCategoryRoutes'));
router.use('/brands',         requireCompany, require('./Product Management/brandRoutes'));
router.use('/products',       requireCompany, require('./Product Management/productRoutes'));

// ── Purchase & Inventory Management ─────────────────────────
router.use('/suppliers',       requireCompany, require('./Purchase & Inventory Management/supplierRoutes'));
router.use('/purchases',       requireCompany, require('./Purchase & Inventory Management/purchaseRoutes'));
router.use('/warehouses',      requireCompany, require('./Purchase & Inventory Management/warehouseRoutes'));
router.use('/inventory',       requireCompany, require('./Purchase & Inventory Management/inventoryRoutes'));
router.use('/stock-transfers', requireCompany, require('./Purchase & Inventory Management/stockTransferRoutes'));

// ── Marketplace Management ───────────────────────────────────
router.use('/enquiries',  requireCompany, require('./Marketplace Management/enquiryRoutes'));
router.use('/orders',     requireCompany, require('./Marketplace Management/orderRoutes'));
router.use('/dispatches', requireCompany, require('./Marketplace Management/dispatchRoutes'));

// ── CRM Management ───────────────────────────────────────────
router.use('/customers', requireCompany, require('./CRM Management/customerRoutes'));
router.use('/leads',     requireCompany, require('./CRM Management/leadRoutes'));
router.use('/followups', requireCompany, require('./CRM Management/followupRoutes'));

// ── Finance Management ───────────────────────────────────────
router.use('/quotations',  requireCompany, require('./Finance Management/quotationRoutes'));
router.use('/sales',       requireCompany, require('./Finance Management/salesRoutes'));
router.use('/expenses',    requireCompany, require('./Finance Management/expenseRoutes'));
router.use('/payments',    requireCompany, require('./Finance Management/paymentRoutes'));
router.use('/accounts',    requireCompany, require('./Finance Management/accountsRoutes'));
router.use('/profit-loss', requireCompany, require('./Finance Management/profitLossRoutes'));

// ── HR Management ─────────────────────────────────────────────
router.use('/employees',  requireCompany, require('./HR Management/employeeRoutes'));
router.use('/attendance', requireCompany, require('./HR Management/attendanceRoutes'));
router.use('/salary',     requireCompany, require('./HR Management/salaryRoutes'));

// ── Reports Management ────────────────────────────────────────
router.use('/reports/dashboard', requireCompany, require('./Reports Management/dashboardRoutes'));
router.use('/reports',           requireCompany, require('./Reports Management/reportRoutes'));

// ── System Management ─────────────────────────────────────────
router.use('/notifications', requireCompany, require('./System Management/notificationRoutes'));
router.use('/documents',     requireCompany, require('./System Management/documentRoutes'));
router.use('/subscriptions', requireCompany, require('./System Management/subscriptionRoutes'));
router.use('/profile',       requireCompany, require('./System Management/profileRoutes'));
router.use('/audit-logs',    requireCompany, require('./System Management/auditLogRoutes'));

module.exports = router;
