/**
 * retailerStaffController.js
 *
 * Retailer-owner manages their own staff from inside the Retailer App.
 *
 * Add staff  → name (required), mobile (required), email (optional)
 * Access     → staff_app_access: array of module keys the staff can see
 * Salary     → salary_breakdown: fixed_salary, incentive_type/value,
 *               sales_percentage, discount_access, max_discount_percent
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

  if (body.incentive_value !== undefined)
    bd.incentive_value = Math.max(0, Number(body.incentive_value) || 0);

  if (body.sales_percentage !== undefined)
    bd.sales_percentage = Math.min(100, Math.max(0, Number(body.sales_percentage) || 0));

  if (body.discount_access !== undefined)
    bd.discount_access = body.discount_access === true || body.discount_access === 'true';

  if (body.max_discount_percent !== undefined)
    bd.max_discount_percent = Math.min(100, Math.max(0, Number(body.max_discount_percent) || 0));

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
  const { name, mobile, email, designation } = req.body;

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
  const { name, mobile, email, designation, is_active } = req.body;

  if (name        !== undefined) staff.name        = String(name).trim();
  if (designation !== undefined) staff.designation = String(designation).trim();
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

module.exports = {
  getAvailableModules,
  listStaff,
  getStaff,
  addStaff,
  updateStaff,
  toggleStaffActive,
  deleteStaff,
};
