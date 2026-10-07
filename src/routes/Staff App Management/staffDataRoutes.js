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
        name:             rs.name,
        mobile:           rs.mobile,
        email:            rs.email,
        designation:      rs.designation,
        salary:           rs.salary_breakdown?.fixed_salary || 0,
        salary_breakdown: rs.salary_breakdown || {},
        staff_app_access: rs.staff_app_access || [],
        assigned_products: Array.isArray(rs.assigned_products) ? rs.assigned_products : [],
        // Normalise retailer's product_discounts → the common discount shape.
        discount_authorizations: Array.isArray(rs.salary_breakdown?.product_discounts)
          ? rs.salary_breakdown.product_discounts.map(d => ({
              product_id:       d.id,
              product_name:     d.name,
              product_code:     d.code,
              max_discount_pct: d.discount,
            }))
          : [],
        incentive_slabs:  Array.isArray(rs.salary_breakdown?.incentive_slabs) ? rs.salary_breakdown.incentive_slabs : [],
        sales_target:     rs.sales_target || 0,
        org_type:         'retailer',
        _isRetailerStaff: true,
      };
      return next();
    }

    // ── HR Employee login (standard Staff App) ─────────────
    const emp = await Employee.findOne({
      company_id: req.user.company_id,
      user_id: req.user._id,
    }).select('name mobile email designation department branch join_date emp_code salary salary_breakdown staff_app_access assigned_products discount_authorizations incentive_slabs sales_target org_type is_active').lean();

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

// ── Discount-cap enforcement for staff-created quotations ─────
// Enforces, at the API level, that a staff member cannot give a discount
// greater than what the admin authorised — per product first, then the flat
// cap. Rejects the request (422) if any line exceeds the allowed limit.
function enforceDiscountCaps(req, res, next) {
  const emp = req.staffEmployee;
  if (!emp) return next(); // non-staff callers unaffected

  const breakdown = emp.salary_breakdown || {};
  const flatCap   = Number(breakdown.max_discount_percent || 0);
  const hasAccess = breakdown.discount_access !== false; // undefined → allowed
  const perItem   = new Map(
    (emp.discount_authorizations || []).map(d => [String(d.product_id), Number(d.max_discount_pct) || 0])
  );

  // Collect the line items from whatever shape the body uses.
  const items = Array.isArray(req.body.items) && req.body.items.length
    ? req.body.items
    : [{
        product_id: req.body.product_id || req.body.productId,
        // Convert a flat ₹ discount to % if rate+qty present; else treat as %.
        discount_percent: req.body.discount_percent,
        discount: req.body.discount,
        qty: req.body.qty || req.body.quantity,
        rate: req.body.rate,
      }];

  for (const it of items) {
    const pid = String(it.product_id || it.productId || '');
    // Resolve the discount percent for this line.
    let discPct = Number(it.discount_percent);
    if (!Number.isFinite(discPct)) {
      const amt  = (Number(it.qty || it.quantity) || 0) * (Number(it.rate) || 0);
      const disc = Number(it.discount) || 0;
      discPct = amt > 0 ? (disc / amt) * 100 : 0;
    }
    if (discPct <= 0) continue; // no discount → nothing to check

    // The allowed cap: a per-item authorisation wins; else the flat cap.
    const allowed = perItem.has(pid) ? perItem.get(pid) : flatCap;

    if (!hasAccess || allowed <= 0) {
      return res.status(422).json({
        success: false,
        message: 'You are not authorised to apply a discount on this item.',
      });
    }
    if (discPct > allowed + 0.001) {
      return res.status(422).json({
        success: false,
        message: `Discount exceeds your authorised limit of ${allowed}% for this item.`,
      });
    }
  }
  next();
}

// ── Quotations ───────────────────────────────────────────────
router.get ('/quotations',     requireModule('quotations'), quotationCtrl.listQuotations);
router.get ('/quotations/:id', requireModule('quotations'), quotationCtrl.getQuotation);
router.post('/quotations',     requireModule('quotations'), enforceDiscountCaps, quotationCtrl.createQuotation);

// ── Products (catalog — read-only, STRICT assigned-items allow-list) ──
// A staff member sees ONLY the products the admin assigned to them
// (`assigned_products`). If none are assigned, they see NOTHING.
// This is enforced here at the API level, not just hidden in the app.
router.get('/products', requireModule('products'), async (req, res) => {
  try {
    const Product  = require('../../models/Product Management/Product');

    const { search = '', page = 1, limit = 500 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const assigned = Array.isArray(req.staffEmployee?.assigned_products)
      ? req.staffEmployee.assigned_products
      : [];

    // No assigned items = no access = empty catalogue (strict).
    if (!assigned.length) {
      return res.json({
        success: true,
        data: { products: [], total: 0, page: parseInt(page), pages: 0 },
      });
    }

    // Only the explicitly-assigned products, and only if still active.
    const query = {
      _id:       { $in: assigned },
      is_active: { $ne: false },
      status:    { $ne: 'deleted' },
    };

    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$and = [{
        $or: [
          { name: regex }, { code: regex }, { alias: regex },
          { size: regex }, { finish: regex }, { color: regex },
          { design: regex }, { collection: regex },
        ],
      }];
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

    res.json({
      success: true,
      message: 'Products retrieved.',
      data: {
        products: withStock,
        total,
        page:  parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
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
        employee_id:  emp._id,
        name:         emp.name || '',
        mobile:       emp.mobile || '',
        email:        emp.email || '',
        designation:  emp.designation || '',
        department:   emp.department || '',
        branch:       emp.branch || '',
        org_type:     emp.org_type || 'admin',
        sales_target: emp.sales_target || 0,
        salary_breakdown: {
          fixed_salary:         breakdown.fixed_salary         ?? emp.salary ?? 0,
          incentive_type:       breakdown.incentive_type       ?? 'none',
          incentive_value:      breakdown.incentive_value      ?? 0,
          sales_percentage:     breakdown.sales_percentage     ?? 0,
          discount_access:      breakdown.discount_access      ?? false,
          max_discount_percent: breakdown.max_discount_percent ?? 0,
          notes:                breakdown.notes                ?? '',
        },
        incentive_slabs:         Array.isArray(emp.incentive_slabs) ? emp.incentive_slabs : [],
        discount_authorizations: Array.isArray(emp.discount_authorizations) ? emp.discount_authorizations : [],
        assigned_product_count:  Array.isArray(emp.assigned_products) ? emp.assigned_products.length : 0,
        staff_app_access:        emp.staff_app_access || [],
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to load profile.' });
  }
});

// ── My Discount Permissions (item-wise max discount %) ───────
// Returns the per-product discount caps the admin granted this staff member,
// plus the flat fallback cap. The app shows these read-only and enforces them.
router.get('/my-discounts', async (req, res) => {
  try {
    const emp = req.staffEmployee;
    if (!emp) {
      return res.status(404).json({ success: false, message: 'Employee record not found for your account.' });
    }
    const breakdown = emp.salary_breakdown || {};
    res.json({
      success: true,
      data: {
        discount_access:         breakdown.discount_access ?? false,
        max_discount_percent:    breakdown.max_discount_percent ?? 0,
        discount_authorizations: Array.isArray(emp.discount_authorizations) ? emp.discount_authorizations : [],
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to load discount permissions.' });
  }
});

// ── My Sales & Incentive (live computed for the current month) ──
// Monthly target vs completed, remaining, incentive % + earned, salary,
// and expected total (salary + incentive).
router.get('/my-sales', async (req, res) => {
  try {
    const emp = req.staffEmployee;
    if (!emp) {
      return res.status(404).json({ success: false, message: 'Employee record not found for your account.' });
    }

    const { computeStaffIncentive } = require('../../controllers/HR Management/employeeController');
    const breakdown  = emp.salary_breakdown || {};
    const salary     = breakdown.fixed_salary ?? emp.salary ?? 0;
    const target     = emp.sales_target || 0;
    const slabs      = Array.isArray(emp.incentive_slabs) ? emp.incentive_slabs : [];

    // For HR Employee staff, sales are attributed to their linked User id.
    // RetailerStaff have no linked User, so monthSales falls back to 0.
    const userId  = emp._isRetailerStaff ? null : (req.user?._id || null);
    const summary = await computeStaffIncentive(req.user.company_id, userId, slabs);

    const completed = summary.monthSales || 0;
    const remaining = Math.max(0, target - completed);

    // Incentive: prefer slab result; else apply flat sales_percentage.
    let incentivePct    = summary.pct || 0;
    let incentiveAmount = summary.amount || 0;
    if (!incentivePct && breakdown.sales_percentage) {
      incentivePct    = breakdown.sales_percentage;
      incentiveAmount = Math.round((completed * incentivePct) / 100 * 100) / 100;
    }

    res.json({
      success: true,
      data: {
        period:            summary.periodLabel,
        sales_target:      target,
        sales_completed:   completed,
        sales_remaining:   remaining,
        target_percent:    target > 0 ? Math.min(100, Math.round((completed / target) * 100)) : 0,
        incentive_percent: incentivePct,
        incentive_earned:  incentiveAmount,
        salary,
        expected_total:    Math.round((salary + incentiveAmount) * 100) / 100,
        slabs,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to load sales summary.' });
  }
});

module.exports = router;
