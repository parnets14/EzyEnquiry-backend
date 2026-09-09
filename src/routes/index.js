const express = require('express');
const { authenticate, requireCompany } = require('../middleware/auth');
const { MODULES, moduleAccess } = require('../config/permissions');

const router = express.Router();

// ── Auth (no auth required) ──────────────────────────────────
router.use('/auth', require('./authRoutes'));

// ── Staff App auth (no auth required) ────────────────────────
router.use('/auth/staff', require('./Staff App Management/staffAuthRoutes'));

// ── All routes below require authentication ──────────────────
router.use(authenticate);

// ── Staff App data (company-scoped, no module gate) ──────────
// Lets an authenticated staff member read their company's Sales Orders and
// Invoices and record invoice payments. Controllers scope by req.user.company_id.
router.use('/staff', requireCompany, require('./Staff App Management/staffDataRoutes'));

// ── Company Management ───────────────────────────────────────
// Company registration/details — Super Admin (all) or Company Owner (own).
// The controller scopes to the caller's company; guard by COMPANY module.
router.use('/companies', moduleAccess(MODULES.COMPANY), require('./Company Management/companyRoutes'));

// ── User Management ──────────────────────────────────────────
router.use('/users', requireCompany, moduleAccess(MODULES.USERS), require('./User Management/userRoutes'));

// ── Product Management ───────────────────────────────────────
router.use('/categories',     requireCompany, moduleAccess(MODULES.CATEGORIES), require('./Product Management/categoryRoutes'));
router.use('/sub-categories', requireCompany, moduleAccess(MODULES.CATEGORIES), require('./Product Management/subCategoryRoutes'));
router.use('/brands',         requireCompany, moduleAccess(MODULES.BRANDS),     require('./Product Management/brandRoutes'));
router.use('/products',       requireCompany, moduleAccess(MODULES.PRODUCTS),   require('./Product Management/productRoutes'));

// ── Purchase & Inventory Management ─────────────────────────
router.use('/suppliers',       requireCompany, moduleAccess(MODULES.SUPPLIERS),      require('./Purchase & Inventory Management/supplierRoutes'));
router.use('/purchases',       requireCompany, moduleAccess(MODULES.PURCHASES),      require('./Purchase & Inventory Management/purchaseRoutes'));
router.use('/warehouses',      requireCompany, moduleAccess(MODULES.WAREHOUSES),     require('./Purchase & Inventory Management/warehouseRoutes'));
router.use('/inventory',       requireCompany, moduleAccess(MODULES.INVENTORY),      require('./Purchase & Inventory Management/inventoryRoutes'));
router.use('/stock-transfers', requireCompany, moduleAccess(MODULES.STOCK_TRANSFER), require('./Purchase & Inventory Management/stockTransferRoutes'));

// ── Marketplace Management ───────────────────────────────────
router.use('/enquiries',  requireCompany, moduleAccess(MODULES.ENQUIRIES),  require('./Marketplace Management/enquiryRoutes'));
router.use('/orders',     requireCompany, moduleAccess(MODULES.ORDERS),     require('./Marketplace Management/orderRoutes'));
router.use('/dispatches', requireCompany, moduleAccess(MODULES.DISPATCHES), require('./Marketplace Management/dispatchRoutes'));

// ── CRM Management ───────────────────────────────────────────
router.use('/customers', requireCompany, moduleAccess(MODULES.CUSTOMERS), require('./CRM Management/customerRoutes'));
router.use('/leads',     requireCompany, moduleAccess(MODULES.LEADS),     require('./CRM Management/leadRoutes'));
router.use('/followups', requireCompany, moduleAccess(MODULES.FOLLOWUPS), require('./CRM Management/followupRoutes'));

// ── Finance Management ───────────────────────────────────────
router.use('/quotations',  requireCompany, moduleAccess(MODULES.QUOTATIONS),  require('./Finance Management/quotationRoutes'));
router.use('/sales',       requireCompany, moduleAccess(MODULES.SALES),       require('./Finance Management/salesRoutes'));
router.use('/expenses',    requireCompany, moduleAccess(MODULES.EXPENSES),    require('./Finance Management/expenseRoutes'));
router.use('/payments',    requireCompany, moduleAccess(MODULES.PAYMENTS),    require('./Finance Management/paymentRoutes'));
router.use('/accounts',    requireCompany, moduleAccess(MODULES.ACCOUNTS),    require('./Finance Management/accountsRoutes'));
router.use('/profit-loss', requireCompany, moduleAccess(MODULES.PROFIT_LOSS), require('./Finance Management/profitLossRoutes'));

// ── HR Management ─────────────────────────────────────────────
// Employee Master (Departments / Designations) — its own module gate.
router.use('/employee-master', requireCompany, moduleAccess(MODULES.EMPLOYEE_MASTER), require('./HR Management/employeeMasterRoutes'));
// The /employees mount also hosts /attendance and /salary sub-routes. Per-feature
// module gates (EMPLOYEES / ATTENDANCE / SALARY) are applied inside the router,
// so only company scope is enforced at this level.
router.use('/employees', requireCompany, require('./HR Management/employeeRoutes'));

// ── Reports Management ────────────────────────────────────────
router.use('/reports/dashboard', requireCompany, moduleAccess(MODULES.DASHBOARD), require('./Reports Management/dashboardRoutes'));
router.use('/reports',           requireCompany, moduleAccess(MODULES.REPORTS),   require('./Reports Management/reportRoutes'));

// ── System Management ─────────────────────────────────────────
router.use('/notifications', requireCompany, moduleAccess(MODULES.NOTIFICATIONS), require('./System Management/notificationRoutes'));
router.use('/documents',     requireCompany, moduleAccess(MODULES.DOCUMENTS),     require('./System Management/documentRoutes'));
router.use('/subscriptions', requireCompany, moduleAccess(MODULES.SUBSCRIPTIONS), require('./System Management/subscriptionRoutes'));
router.use('/profile',       requireCompany, moduleAccess(MODULES.PROFILE),       require('./System Management/profileRoutes'));

// Role & Permission Management — admin config (guarded inside the route file).
// '/me' is readable by any authenticated company user to drive their own menu.
router.use('/role-permissions', requireCompany, require('./System Management/rolePermissionRoutes'));
router.use('/audit-logs',    requireCompany, require('./System Management/auditLogRoutes'));

module.exports = router;
