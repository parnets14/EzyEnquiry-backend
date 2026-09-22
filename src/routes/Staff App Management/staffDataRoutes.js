/**
 * staffDataRoutes.js
 *
 * Read + light-write endpoints for the Staff mobile app, mounted at /api/staff.
 * These reuse the existing company-scoped controllers so a staff member can see
 * the company's data and perform lightweight actions (record payment, add customer,
 * create quotation) without needing full CRM module permissions.
 *
 * Auth: the parent router already applies `authenticate` + `requireCompany`,
 * so every controller here is scoped by req.user.company_id.
 *
 * Access control: If the logged-in staff member's Employee record has a non-empty
 * staff_app_access array, only those listed modules are accessible.
 * An empty array means unrestricted access to all modules.
 */
const express  = require('express');
const router   = express.Router();
const Employee = require('../../models/HR Management/Employee');

const orderCtrl        = require('../../controllers/Marketplace Management/orderController');
const dispatchCtrl     = require('../../controllers/Marketplace Management/dispatchController');
const invoiceCtrl      = require('../../controllers/Finance Management/invoiceController');
const customerCtrl     = require('../../controllers/CRM Management/customerController');
const quotationCtrl    = require('../../controllers/Finance Management/quotationController');
const notificationCtrl = require('../../controllers/System Management/notificationController');

// ── Step 1: Mark every request as staff-app + load access list ──
// Fetches the employee's staff_app_access once per request and caches
// it on req so individual module guards can read it cheaply.
router.use(async (req, res, next) => {
  req.isStaffApp = true;
  req.staffAppAccess = []; // default = all access

  try {
    // ── RetailerStaff login (token has app:'retailer_staff') ──
    if (req.retailerStaff) {
      const rs = req.retailerStaff;
      if (Array.isArray(rs.staff_app_access) && rs.staff_app_access.length > 0) {
        req.staffAppAccess = rs.staff_app_access;
      }
      req.staffEmployee = {
        _id:              rs._id,
        company_id:       rs.company_id,
        salary_breakdown: rs.salary_breakdown || {},
        staff_app_access: rs.staff_app_access || [],
        _isRetailerStaff: true,
      };
      return next();
    }

    // ── HR Employee login (standard Staff App) ─────────────
    const emp = await Employee.findOne({
      company_id: req.user.company_id,
      user_id: req.user._id,
    }).select('staff_app_access salary_breakdown salary').lean();

    if (emp && Array.isArray(emp.staff_app_access) && emp.staff_app_access.length > 0) {
      req.staffAppAccess = emp.staff_app_access;
    }
    req.staffEmployee = emp || null;
  } catch (_err) {
    // Non-fatal — fall back to full access
  }
  next();
});

// ── Step 2: Module guard factory ────────────────────────────────
// Returns a middleware that blocks access to a module key
// if the staff member's access list is non-empty AND doesn't include it.
function requireModule(moduleKey) {
  return (req, res, next) => {
    const access = req.staffAppAccess;
    // Empty means unrestricted
    if (!access || access.length === 0) return next();
    if (access.includes(moduleKey)) return next();
    return res.status(403).json({
      success: false,
      message: `Access denied. You do not have access to the ${moduleKey} module.`,
      module: moduleKey,
    });
  };
}

// ── Sales Orders ─────────────────────────────────────────────
router.get('/orders',     requireModule('orders'), orderCtrl.listOrders);
router.get('/orders/:id', requireModule('orders'), orderCtrl.getOrder);

// ── Dispatches ───────────────────────────────────────────────
router.get('/dispatches',     requireModule('dispatches'), dispatchCtrl.listDispatches);
router.get('/dispatches/:id', requireModule('dispatches'), dispatchCtrl.getDispatch);

// ── Invoices (finance module covers invoices + payments) ─────
router.get ('/invoices',                           requireModule('finance'), invoiceCtrl.listInvoices);
router.get ('/invoices/summary',                   requireModule('finance'), invoiceCtrl.getInvoiceSummary);
router.get ('/invoices/:id',                       requireModule('finance'), invoiceCtrl.getInvoice);
router.post('/invoices/:id/payment',               requireModule('finance'), invoiceCtrl.recordPayment);
router.post('/invoices/:id/payment/:phId/verify',  requireModule('finance'), invoiceCtrl.verifyPayment);

// ── Customers ────────────────────────────────────────────────
router.get ('/customers',     requireModule('customers'), customerCtrl.listCustomers);
router.get ('/customers/:id', requireModule('customers'), customerCtrl.getCustomer);
router.post('/customers',     requireModule('customers'), customerCtrl.createCustomer);

// ── Quotations ───────────────────────────────────────────────
router.get ('/quotations',     requireModule('quotations'), quotationCtrl.listQuotations);
router.get ('/quotations/:id', requireModule('quotations'), quotationCtrl.getQuotation);
router.post('/quotations',     requireModule('quotations'), quotationCtrl.createQuotation);

// ── Products (catalog — read-only search) ─────────────────────
// Returns all active, non-deleted products with full brand/category population.
// No company filter — staff can see all products to create quotations.
router.get('/products', requireModule('products'), async (req, res) => {
  try {
    const Product  = require('../../models/Product Management/Product');
    const { paginate } = require('../../utils/helpers');

    const { search = '', page = 1, limit = 500 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // No company_id filter — return all active products so staff can browse
    // the full catalogue regardless of which company created each product.
    const query = {
      is_active: { $ne: false },
      status:    { $ne: 'deleted' },
    };

    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { name: regex }, { code: regex }, { alias: regex },
        { size: regex }, { finish: regex }, { color: regex },
        { design: regex }, { collection: regex },
      ];
    }

    const [total, products] = await Promise.all([
      Product.countDocuments(query),
      Product.find(query)
        .populate('brand_id',        'name code')
        .populate('category_id',     'name code')
        .populate('sub_category_id', 'name code')
        .populate('company_id',      'name biz_type')
        .populate('created_by',      'name role')
        .sort({ featured: -1, new_arrival: -1, name: 1 })
        .skip(offset)
        .limit(parseInt(limit))
        .lean(),
    ]);

    // Join live inventory so the Staff App can show real available stock next
    // to each product (the app already renders `p.stock`). We sum available
    // stock across warehouses per product; fall back to current_stock for
    // legacy records.
    const Inventory = require('../../models/Purchase & Inventory Management/Inventory');
    const productIds = products.map(p => p._id);
    const stockByProduct = new Map();
    if (productIds.length) {
      const invRows = await Inventory.aggregate([
        { $match: { product_id: { $in: productIds } } },
        {
          $group: {
            _id: '$product_id',
            available: { $sum: { $max: ['$available_stock', '$current_stock'] } },
            physical:  { $sum: { $max: ['$physical_stock',  '$current_stock'] } },
          },
        },
      ]);
      invRows.forEach(r => stockByProduct.set(String(r._id), r));
    }
    const withStock = products.map(p => {
      const s = stockByProduct.get(String(p._id));
      return {
        ...p,
        available_stock: s ? Math.max(s.available, 0) : 0,
        physical_stock:  s ? Math.max(s.physical, 0)  : 0,
        current_stock:   s ? Math.max(s.available, 0) : 0, // legacy mirror for the app
      };
    });

    console.log(`[Staff Products] company=${req.user.company_id} total_all=${total} returning=${withStock.length}`);
    // Debug: log each product's company biz_type + created_by_type so mismatches are visible
    withStock.forEach(p => {
      const cName     = p.company_id?.name     || '(no name)';
      const cBizType  = p.company_id?.biz_type || '(no biz_type)';
      const createdBy = p.created_by_type      || '(none)';
      console.log(`  [Product] "${p.name}" | company="${cName}" biz_type="${cBizType}" created_by_type="${createdBy}"`);
    });

    res.json({
      success: true,
      message: 'Products retrieved.',
      data: {
        products: withStock,
        pagination: paginate(total, parseInt(page), parseInt(limit)),
      },
    });
  } catch (err) {
    console.error('[Staff Products] error:', err.message);
    res.status(500).json({ success: false, message: err.message || 'Failed to load products.' });
  }
});

// ── Notifications (scoped to company user) ────────────────────
router.get   ('/notifications',               requireModule('notifications'), notificationCtrl.listNotifications);
router.patch ('/notifications/mark-all-read', requireModule('notifications'), notificationCtrl.markAllNotificationsRead);
router.patch ('/notifications/:id/read',      requireModule('notifications'), notificationCtrl.markNotificationRead);
router.delete('/notifications/:id',           requireModule('notifications'), notificationCtrl.deleteNotification);

// ── My Salary (staff views own payslips + breakdown) ─────────
router.get('/my-salary', requireModule('salary'), async (req, res) => {
  try {
    const SalaryRecord = require('../../models/HR Management/SalaryRecord');
    const { month, year, page = 1, limit = 12 } = req.query;
    const emp = req.staffEmployee;

    if (!emp) {
      return res.status(404).json({ success: false, message: 'Employee record not found for your account.' });
    }

    const query = { company_id: req.user.company_id, employee_id: emp._id };
    if (month) query.month = parseInt(month);
    if (year)  query.year  = parseInt(year);

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const [total, records] = await Promise.all([
      SalaryRecord.countDocuments(query),
      SalaryRecord.find(query)
        .sort({ year: -1, month: -1 })
        .skip(offset)
        .limit(parseInt(limit))
        .lean(),
    ]);

    // Attach the salary breakdown config so the app can display the structure
    const breakdown = emp.salary_breakdown || {};

    res.json({
      success: true,
      data: {
        salary_breakdown: {
          fixed_salary:         breakdown.fixed_salary         ?? emp.salary ?? 0,
          incentive_type:       breakdown.incentive_type       ?? 'none',
          incentive_value:      breakdown.incentive_value      ?? 0,
          sales_percentage:     breakdown.sales_percentage     ?? 0,
          discount_access:      breakdown.discount_access      ?? false,
          max_discount_percent: breakdown.max_discount_percent ?? 0,
          notes:                breakdown.notes                ?? '',
        },
        salary_records: records,
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to load salary.' });
  }
});

// ── My Attendance (staff views own records) ──────────────────
router.get('/my-attendance', requireModule('attendance'), async (req, res) => {
  try {
    const Attendance = require('../../models/HR Management/Attendance');
    const emp = req.staffEmployee;

    if (!emp) {
      return res.status(404).json({ success: false, message: 'Employee record not found for your account.' });
    }

    const { month, year, page = 1, limit = 31 } = req.query;
    const query = { company_id: req.user.company_id, employee_id: emp._id };

    if (month && year) {
      const from = new Date(parseInt(year), parseInt(month) - 1, 1);
      const to   = new Date(parseInt(year), parseInt(month), 1);
      query.date = { $gte: from, $lt: to };
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const [total, records] = await Promise.all([
      Attendance.countDocuments(query),
      Attendance.find(query)
        .sort({ date: -1 })
        .skip(offset)
        .limit(parseInt(limit))
        .lean(),
    ]);

    res.json({
      success: true,
      data: {
        attendance: records,
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to load attendance.' });
  }
});

// ── My Profile / Discount Access ────────────────────────────
// Returns the logged-in staff member's own profile including salary breakdown.
// The app uses discount_access + max_discount_percent when creating quotations.
router.get('/my-profile', async (req, res) => {
  try {
    const emp = req.staffEmployee;
    if (!emp) {
      return res.status(404).json({ success: false, message: 'Employee record not found for your account.' });
    }

    const breakdown = emp.salary_breakdown || {};
    res.json({
      success: true,
      data: {
        employee_id:      emp._id,
        salary_breakdown: {
          fixed_salary:         breakdown.fixed_salary         ?? emp.salary ?? 0,
          incentive_type:       breakdown.incentive_type       ?? 'none',
          incentive_value:      breakdown.incentive_value      ?? 0,
          sales_percentage:     breakdown.sales_percentage     ?? 0,
          discount_access:      breakdown.discount_access      ?? false,
          max_discount_percent: breakdown.max_discount_percent ?? 0,
          notes:                breakdown.notes                ?? '',
        },
        staff_app_access: emp.staff_app_access || [],
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to load profile.' });
  }
});

module.exports = router;
