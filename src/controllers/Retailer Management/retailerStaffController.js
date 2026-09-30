/**
 * retailerStaffController.js
 *
 * Retailer-owner manages their own staff from inside the Retailer App.
 *
 * Add staff  → name (required), mobile (required), email (optional)
 * Access     → staff_app_access: array of module keys the staff can see
 * Salary     → salary_breakdown: fixed_salary, incentive_type/value,
 *               incentive_base_amount, incentive_slabs, sales_percentage,
 *               discount_access, max_discount_percent, product_discounts
 *
 * All routes are scoped to req.user.company_id (the retailer's company).
 * Only the Retailer owner role can manage staff (enforced in routes).
 */

const RetailerStaff = require('../../models/Retailer Management/RetailerStaff');
const { RETAILER_APP_MODULES } = require('../../models/Retailer Management/RetailerStaff');
const { sendSuccess, sendError, paginate } = require('../../utils/helpers');

// ─── Internal helpers ─────────────────────────────────────────

/**
 * Only the Retailer owner can manage staff — not a RetailerStaff member themselves.
 * Call this at the top of each write handler.
 */
function ownerOnly(req, res) {
  if (req.user?.role === 'RetailerStaff') {
    res.status(403).json({
      success: false,
      message: 'Only the retailer owner can manage staff members.',
    });
    return false;
  }
  return true;
}

function normaliseMobile(value) {
  return String(value || '').replace(/\D/g, '').slice(-10);
}

/** Escape user input before embedding it in a RegExp (prevents regex injection). */
function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validate and de-duplicate the staff_app_access array.
 * Accepts an array OR a comma-separated string.
 */
function parseAccessModules(raw) {
  if (raw === undefined || raw === null) return { ok: true, modules: [] };

  const arr = Array.isArray(raw)
    ? raw
    : String(raw).split(',').map(s => s.trim()).filter(Boolean);

  const invalid = arr.filter(m => !RETAILER_APP_MODULES.includes(m));
  if (invalid.length) {
    return {
      ok: false,
      error: `Invalid module(s): ${invalid.join(', ')}. Allowed: ${RETAILER_APP_MODULES.join(', ')}`,
    };
  }
  return { ok: true, modules: [...new Set(arr)] };
}

/**
 * Sanitise incentive slabs: keep only rows with a positive sales amount and a
 * non-negative percentage, de-duplicate by sales amount (last one wins), and
 * sort ascending so "highest reached slab applies" is a simple scan.
 */
function sanitizeSlabs(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Map();
  for (const s of raw) {
    const amount = Number(s?.sales_amount);
    const pct    = Number(s?.incentive_pct);
    if (!isFinite(amount) || amount <= 0) continue;
    if (!isFinite(pct) || pct < 0) continue;
    seen.set(amount, { sales_amount: amount, incentive_pct: pct });
  }
  return [...seen.values()].sort((a, b) => a.sales_amount - b.sales_amount);
}

/**
 * Sanitise per-product discount authorizations. Keeps rows that reference a
 * product and carry a 0–100 discount. mrp/retailPrice are display snapshots.
 */
function sanitizeProductDiscounts(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Map();
  for (const d of raw) {
    const id = String(d?.id || d?._id || '').trim();
    if (!id) continue;
    const discount = Number(d?.discount);
    if (!isFinite(discount) || discount < 0 || discount > 100) continue;
    seen.set(id, {
      id,
      name:        String(d?.name || '').trim(),
      code:        String(d?.code || '').trim(),
      mrp:         Math.max(0, Number(d?.mrp) || 0),
      retailPrice: Math.max(0, Number(d?.retailPrice ?? d?.retail_price) || 0),
      discount,
    });
  }
  return [...seen.values()];
}

/**
 * Sanitise salary breakdown fields from request body.
 * Only fields that were actually supplied are included in the result
 * so callers can do a safe merge without wiping untouched fields.
 */
function parseSalaryBreakdown(body) {
  const bd = {};

  if (body.fixed_salary !== undefined)
    bd.fixed_salary = Math.max(0, Number(body.fixed_salary) || 0);

  const validTypes = ['fixed', 'percentage', 'none'];
  if (body.incentive_type !== undefined)
    bd.incentive_type = validTypes.includes(body.incentive_type) ? body.incentive_type : 'none';

  // DEPRECATED — the "Amount (₹) × Percentage (%)" pair was removed from the
  // Add Staff form to match the wholesaler, whose incentive model is slabs-only.
  // Force these to 0 so values saved by an older build cannot linger on the
  // record and still skew the incentive preview.
  bd.incentive_value = Math.max(0, Number(body.incentive_value) || 0);
  bd.incentive_base_amount = 0;

  // Incentive slabs (sales amount → incentive %).
  if (body.incentive_slabs !== undefined)
    bd.incentive_slabs = sanitizeSlabs(body.incentive_slabs);

  if (body.sales_percentage !== undefined)
    bd.sales_percentage = Math.min(100, Math.max(0, Number(body.sales_percentage) || 0));

  if (body.discount_access !== undefined)
    bd.discount_access = body.discount_access === true || body.discount_access === 'true';

  if (body.max_discount_percent !== undefined)
    bd.max_discount_percent = Math.min(100, Math.max(0, Number(body.max_discount_percent) || 0));

  // Per-product discount limits.
  if (body.product_discounts !== undefined)
    bd.product_discounts = sanitizeProductDiscounts(body.product_discounts);

  if (body.salary_notes !== undefined)
    bd.notes = String(body.salary_notes || '').trim();

  return bd;
}

// ─── GET /api/retailer/staff/modules ────────────────────────────
// Returns the full labelled list of modules — used to render
// the access checkbox grid in the Retailer App UI.
// Keys match 1-to-1 with Staff App navigator screen groups.
async function getAvailableModules(_req, res) {
  const modules = [
    { key: 'dashboard',     label: 'Dashboard',     description: 'Summary stats and quick links' },
    { key: 'products',      label: 'Products',       description: 'Browse the product catalogue' },
    { key: 'enquiries',     label: 'Enquiries',      description: 'Create and track enquiries' },
    { key: 'orders',        label: 'Orders',         description: 'Place and track orders' },
    { key: 'invoices',      label: 'Invoices',       description: 'View invoices and make payments' },
    { key: 'customers',     label: 'Customers',      description: 'Manage retailer customers' },
    { key: 'notifications', label: 'Notifications',  description: 'In-app and push notifications' },
    { key: 'reports',       label: 'Reports',        description: 'Sales and order reports' },
    // ── ERP modules (added 2026-09-29) ──
    { key: 'sales',         label: 'Sales',          description: 'Record sales and view sales reports' },
    { key: 'purchases',     label: 'Purchase',       description: 'Purchase entries, bills and suppliers' },
    { key: 'inventory',     label: 'Inventory',      description: 'Stock, warehouses and transfers' },
    { key: 'expenses',      label: 'Expense',        description: 'Record and report business expenses' },
    { key: 'payments',      label: 'Payments',       description: 'Receivables and payables' },
    { key: 'accounts',      label: 'Accounts',       description: 'Ledgers, cash book and bank book' },
    { key: 'profit_loss',   label: 'Profit & Loss',  description: 'Profit and loss dashboard' },
    { key: 'leads',         label: 'Leads',          description: 'Track and convert sales leads' },
    { key: 'dispatches',    label: 'Dispatch',       description: 'Track shipments, update status and upload POD' },
    { key: 'documents',     label: 'Documents',      description: 'Store and share business documents' },
  ];
  sendSuccess(res, { modules });
}

// ─── GET /api/retailer/staff ─────────────────────────────────
async function listStaff(req, res) {
  const { search = '', is_active, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = { company_id: req.user.company_id };
  if (is_active !== undefined) query.is_active = is_active !== 'false';

  if (search) {
    const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [
      { name: regex },
      { mobile: regex },
      { email: regex },
      { designation: regex },
    ];
  }

  const [total, staff] = await Promise.all([
    RetailerStaff.countDocuments(query),
    RetailerStaff.find(query)
      .sort({ name: 1 })
      .skip(offset)
      .limit(parseInt(limit))
      .lean(),
  ]);

  sendSuccess(res, {
    staff,
    available_modules: RETAILER_APP_MODULES,
    pagination: paginate(total, parseInt(page), parseInt(limit)),
  });
}

// ─── GET /api/retailer/staff/:id ─────────────────────────────
async function getStaff(req, res) {
  const staff = await RetailerStaff.findOne({
    _id: req.params.id,
    company_id: req.user.company_id,
  }).lean();

  if (!staff) return sendError(res, 'Staff member not found.', 404);

  sendSuccess(res, { staff, available_modules: RETAILER_APP_MODULES });
}

// ─── POST /api/retailer/staff ────────────────────────────────
/**
 * Body fields:
 *   name               (required)
 *   mobile             (required, 10-digit)
 *   email              (optional)
 *   designation        (optional)
 *   staff_app_access   (optional) array or comma-string of module keys
 *                      — empty / omitted means access to ALL modules
 *   fixed_salary       (optional)
 *   incentive_type     (optional) "fixed" | "percentage" | "none"
 *   incentive_value    (optional)
 *   sales_percentage   (optional) 0–100
 *   discount_access    (optional) true/false
 *   max_discount_percent (optional) 0–100
 *   salary_notes       (optional)
 */
async function addStaff(req, res) {
  if (!ownerOnly(req, res)) return;
  const { name, mobile, email, designation, role_access } = req.body;

  // ── Validation ────────────────────────────────────────────
  if (!name || !String(name).trim()) {
    return sendError(res, 'Staff name is required.');
  }

  const digits = normaliseMobile(mobile);
  if (digits.length !== 10) {
    return sendError(res, 'A valid 10-digit mobile number is required.');
  }

  // Duplicate mobile within same retailer company
  const existing = await RetailerStaff.findOne({
    company_id: req.user.company_id,
    mobile: digits,
  }).lean();
  if (existing) {
    return sendError(res, `A staff member with mobile ${digits} already exists in your company.`, 409);
  }

  // ── Module access ─────────────────────────────────────────
  const { ok, modules, error: accessErr } = parseAccessModules(req.body.staff_app_access);
  if (!ok) return sendError(res, accessErr);

  // ── Salary breakdown ──────────────────────────────────────
  const salaryBd = parseSalaryBreakdown(req.body);

  // ── Create ────────────────────────────────────────────────
  const staff = await RetailerStaff.create({
    company_id:       req.user.company_id,
    name:             String(name).trim(),
    mobile:           digits,
    email:            email ? String(email).toLowerCase().trim() : '',
    designation:      designation ? String(designation).trim() : '',
    role_access:      role_access ? String(role_access).trim() : '',
    staff_app_access: modules,
    salary_breakdown: salaryBd,
    is_active:        true,
  });

  sendSuccess(res, { staff }, 'Staff member added successfully.', 201);
}

// ─── PUT /api/retailer/staff/:id ─────────────────────────────
// All fields optional — only supplied fields are updated.
async function updateStaff(req, res) {
  if (!ownerOnly(req, res)) return;
  const staff = await RetailerStaff.findOne({
    _id: req.params.id,
    company_id: req.user.company_id,
  });
  if (!staff) return sendError(res, 'Staff member not found.', 404);

  // ── Profile ───────────────────────────────────────────────
  const { name, mobile, email, designation, role_access, is_active } = req.body;

  if (name        !== undefined) staff.name        = String(name).trim();
  if (designation !== undefined) staff.designation = String(designation).trim();
  if (role_access !== undefined) staff.role_access = String(role_access).trim();
  if (is_active   !== undefined) staff.is_active   = is_active !== false && is_active !== 'false';

  if (email !== undefined)
    staff.email = email ? String(email).toLowerCase().trim() : '';

  if (mobile !== undefined) {
    const digits = normaliseMobile(mobile);
    if (digits.length !== 10) return sendError(res, 'A valid 10-digit mobile number is required.');

    if (digits !== staff.mobile) {
      const dup = await RetailerStaff.findOne({
        company_id: req.user.company_id,
        mobile: digits,
        _id: { $ne: staff._id },
      }).lean();
      if (dup) return sendError(res, `Mobile ${digits} is already assigned to another staff member.`, 409);
    }
    staff.mobile = digits;
  }

  // ── Module access ─────────────────────────────────────────
  if (req.body.staff_app_access !== undefined) {
    const { ok, modules, error: accessErr } = parseAccessModules(req.body.staff_app_access);
    if (!ok) return sendError(res, accessErr);
    staff.staff_app_access = modules;
  }

  // ── Salary breakdown (merge) ──────────────────────────────
  const salaryBd = parseSalaryBreakdown(req.body);
  if (Object.keys(salaryBd).length) {
    Object.assign(staff.salary_breakdown, salaryBd);
    staff.markModified('salary_breakdown');
  }

  await staff.save();
  sendSuccess(res, { staff: staff.toObject() }, 'Staff member updated.');
}

// ─── PATCH /api/retailer/staff/:id/toggle-active ─────────────
async function toggleStaffActive(req, res) {
  if (!ownerOnly(req, res)) return;
  const staff = await RetailerStaff.findOne({
    _id: req.params.id,
    company_id: req.user.company_id,
  });
  if (!staff) return sendError(res, 'Staff member not found.', 404);

  staff.is_active = !staff.is_active;
  await staff.save();

  sendSuccess(
    res,
    { id: staff._id, is_active: staff.is_active },
    staff.is_active ? 'Staff member activated.' : 'Staff member deactivated.'
  );
}

// ─── DELETE /api/retailer/staff/:id ──────────────────────────
async function deleteStaff(req, res) {
  if (!ownerOnly(req, res)) return;
  const result = await RetailerStaff.deleteOne({
    _id: req.params.id,
    company_id: req.user.company_id,
  });
  if (result.deletedCount === 0) return sendError(res, 'Staff member not found.', 404);
  sendSuccess(res, null, 'Staff member deleted.');
}

// ─── GET /api/retailer/staff/:id/incentive ───────────────────
/**
 * Current-month sales + earned incentive for a staff member.
 *
 * ATTRIBUTION CAVEAT — read before relying on this number:
 * Retailer staff log in via OTP against the RetailerStaff collection and there
 * is no `user_id` linking them to the `User` documents that orders reference in
 * `Order.created_by`. Orders placed while a staff member is logged in are
 * stamped with the **retailer owner's** User id. So per-staff sales cannot be
 * derived from Order.created_by.
 *
 * This endpoint therefore matches orders by the staff member's NAME in
 * `created_by_name` / `created_by_person`, scoped to the owner's company.
 * That is a best-effort match: it is correct only when the staff member's name
 * is recorded on the order. `basis` is returned so the UI can label it.
 *
 * Also returns the slab that applies, reusing the same "highest reached slab
 * wins" rule as the wholesaler employee incentive.
 */
async function getStaffIncentive(req, res) {
  if (!ownerOnly(req, res)) return;

  const staff = await RetailerStaff.findOne({
    _id: req.params.id,
    company_id: req.user.company_id,
  }).lean();
  if (!staff) return sendError(res, 'Staff member not found.', 404);

  const bd    = staff.salary_breakdown || {};
  const slabs = sanitizeSlabs(bd.incentive_slabs || []);

  // ── Current month window ─────────────────────────────────
  const now  = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to   = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  // ── Best-effort sales match by name ──────────────────────
  let monthSales = 0;
  let orderCount = 0;
  try {
    const Order = require('../../models/Marketplace Management/Order');
    const name  = String(staff.name || '').trim();
    if (name) {
      const rows = await Order.aggregate([
        {
          $match: {
            company_id: { $in: [req.user.company_id] },
            status: { $ne: 'Cancelled' },
            created_at: { $gte: from, $lt: to },
            $or: [
              { created_by_name:   { $regex: `^${escapeRegex(name)}$`, $options: 'i' } },
              { created_by_person: { $regex: `^${escapeRegex(name)}$`, $options: 'i' } },
            ],
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: { $ifNull: ['$total_amount', '$total'] } },
            count: { $sum: 1 },
          },
        },
      ]);
      monthSales = rows[0]?.total || 0;
      orderCount = rows[0]?.count || 0;
    }
  } catch {
    // Order model shape differences must not break the staff form.
    monthSales = 0;
    orderCount = 0;
  }

  // ── Highest reached slab wins ────────────────────────────
  let pct = 0;
  for (const slab of slabs) {
    if (monthSales >= slab.sales_amount) pct = slab.incentive_pct;
  }
  const amount = Math.round((monthSales * pct) / 100 * 100) / 100;

  sendSuccess(res, {
    periodLabel: from.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
    from,
    to,
    monthSales,
    orderCount,
    pct,
    amount,
    slabs,
    // How the sales figure was derived — the UI labels the card with this.
    basis: 'matched_by_name',
    basisNote: 'Matched on the staff name recorded against orders.',
  });
}

module.exports = {
  getAvailableModules,
  listStaff,
  getStaff,
  addStaff,
  updateStaff,
  toggleStaffActive,
  deleteStaff,
  getStaffIncentive,
};
