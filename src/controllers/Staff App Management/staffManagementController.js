/**
 * staffManagementController.js
 *
 * Admin-side CRUD for managing staff members in the Staff App.
 * Handles: add staff (name, mobile, optional email), assign module access,
 * set salary breakdown (fixed salary, incentive, sales %, discount access).
 *
 * All routes are company-scoped (req.user.company_id).
 */

const Employee = require('../../models/HR Management/Employee');
const User     = require('../../models/User Management/User');
const { STAFF_APP_MODULES } = require('../../models/HR Management/Employee');
const { sendSuccess, sendError, paginate } = require('../../utils/helpers');

// ── Helpers ──────────────────────────────────────────────────

function normaliseMobile(value) {
  return String(value || '').replace(/\D/g, '').slice(-10);
}

/**
 * Validate and sanitise the staff_app_access array.
 * Accepts a comma-separated string or an array.
 * Returns { ok, modules, error }.
 */
function parseAccessModules(raw) {
  if (raw === undefined || raw === null) return { ok: true, modules: [] };

  const arr = Array.isArray(raw)
    ? raw
    : String(raw).split(',').map(s => s.trim()).filter(Boolean);

  const invalid = arr.filter(m => !STAFF_APP_MODULES.includes(m));
  if (invalid.length) {
    return {
      ok: false,
      error: `Invalid module(s): ${invalid.join(', ')}. Allowed: ${STAFF_APP_MODULES.join(', ')}`,
    };
  }
  return { ok: true, modules: [...new Set(arr)] };
}

/**
 * Sanitise salary breakdown fields from request body.
 */
function parseSalaryBreakdown(body) {
  const bd = {};

  if (body.fixed_salary !== undefined)   bd.fixed_salary   = Math.max(0, Number(body.fixed_salary)   || 0);

  const validIncentiveTypes = ['fixed', 'percentage', 'none'];
  if (body.incentive_type !== undefined) {
    bd.incentive_type = validIncentiveTypes.includes(body.incentive_type) ? body.incentive_type : 'none';
  }
  if (body.incentive_value !== undefined) bd.incentive_value = Math.max(0, Number(body.incentive_value) || 0);

  if (body.sales_percentage !== undefined) {
    bd.sales_percentage = Math.min(100, Math.max(0, Number(body.sales_percentage) || 0));
  }

  if (body.discount_access !== undefined)      bd.discount_access      = Boolean(body.discount_access);
  if (body.max_discount_percent !== undefined) {
    bd.max_discount_percent = Math.min(100, Math.max(0, Number(body.max_discount_percent) || 0));
  }

  if (body.salary_notes !== undefined) bd.notes = String(body.salary_notes || '').trim();

  return bd;
}

// ── Controllers ──────────────────────────────────────────────

/**
 * GET /api/staff-management
 * List all staff for the company with optional filters.
 */
async function listStaff(req, res) {
  const { search = '', is_active, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = { company_id: req.user.company_id };
  if (is_active !== undefined) query.is_active = is_active !== 'false';

  if (search) {
    const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [{ name: regex }, { mobile: regex }, { email: regex }, { designation: regex }];
  }

  const [total, staff] = await Promise.all([
    Employee.countDocuments(query),
    Employee.find(query)
      .populate('user_id', 'email role last_login is_active')
      .sort({ name: 1 })
      .skip(offset)
      .limit(parseInt(limit))
      .lean(),
  ]);

  sendSuccess(res, {
    staff,
    modules: STAFF_APP_MODULES,
    pagination: paginate(total, parseInt(page), parseInt(limit)),
  });
}

/**
 * GET /api/staff-management/:id
 * Get a single staff member with full salary breakdown and access list.
 */
async function getStaff(req, res) {
  const emp = await Employee.findOne({
    _id: req.params.id,
    company_id: req.user.company_id,
  })
    .populate('user_id', 'email role last_login is_active')
    .lean();

  if (!emp) return sendError(res, 'Staff member not found.', 404);

  sendSuccess(res, { staff: emp, available_modules: STAFF_APP_MODULES });
}

/**
 * POST /api/staff-management
 * Add a new staff member.
 *
 * Body:
 *   name            (required)
 *   mobile          (required, 10-digit)
 *   email           (optional)
 *   designation     (optional)
 *   department      (optional)
 *   branch          (optional)
 *   join_date       (optional)
 *   emp_code        (optional)
 *
 *   staff_app_access  (optional) — array or comma-string of module keys
 *
 *   fixed_salary        (optional)
 *   incentive_type      (optional) fixed | percentage | none
 *   incentive_value     (optional)
 *   sales_percentage    (optional)
 *   discount_access     (optional) true/false
 *   max_discount_percent (optional)
 *   salary_notes        (optional)
 */
async function addStaff(req, res) {
  const { name, mobile, email } = req.body;

  // ── Validation ──────────────────────────────────────────────
  if (!name || !String(name).trim()) {
    return sendError(res, 'Staff name is required.');
  }

  const digits = normaliseMobile(mobile);
  if (digits.length !== 10) {
    return sendError(res, 'A valid 10-digit mobile number is required.');
  }

  // Duplicate mobile check within same company
  const existing = await Employee.findOne({
    company_id: req.user.company_id,
    mobile: { $regex: `${digits}$` },
  }).lean();
  if (existing) {
    return sendError(res, `A staff member with mobile ${digits} already exists.`, 409);
  }

  // ── Module access ───────────────────────────────────────────
  const { ok, modules, error: accessErr } = parseAccessModules(req.body.staff_app_access);
  if (!ok) return sendError(res, accessErr);

  // ── Salary breakdown ────────────────────────────────────────
  const salaryBd = parseSalaryBreakdown(req.body);

  // ── Create ──────────────────────────────────────────────────
  const emp = await Employee.create({
    company_id:       req.user.company_id,
    name:             String(name).trim(),
    mobile:           digits,
    email:            email ? String(email).toLowerCase().trim() : '',
    emp_code:         req.body.emp_code    || '',
    designation:      req.body.designation || '',
    department:       req.body.department  || '',
    branch:           req.body.branch      || '',
    join_date:        req.body.join_date   || null,
    salary:           salaryBd.fixed_salary ?? 0,
    salary_breakdown: salaryBd,
    staff_app_access: modules,
  });

  sendSuccess(res, { staff: emp }, 'Staff member added successfully.', 201);
}

/**
 * PUT /api/staff-management/:id
 * Update a staff member's profile, access, and/or salary breakdown.
 *
 * All fields are optional — only supplied fields are updated.
 */
async function updateStaff(req, res) {
  const emp = await Employee.findOne({
    _id: req.params.id,
    company_id: req.user.company_id,
  });
  if (!emp) return sendError(res, 'Staff member not found.', 404);

  // ── Profile fields ──────────────────────────────────────────
  const { name, mobile, email, designation, department, branch, join_date, emp_code, is_active } = req.body;

  if (name        !== undefined) emp.name        = String(name).trim();
  if (emp_code    !== undefined) emp.emp_code    = emp_code;
  if (designation !== undefined) emp.designation = designation;
  if (department  !== undefined) emp.department  = department;
  if (branch      !== undefined) emp.branch      = branch;
  if (join_date   !== undefined) emp.join_date   = join_date || null;
  if (is_active   !== undefined) emp.is_active   = is_active !== false && is_active !== 'false';

  if (email !== undefined) {
    emp.email = email ? String(email).toLowerCase().trim() : '';
  }

  if (mobile !== undefined) {
    const digits = normaliseMobile(mobile);
    if (digits.length !== 10) return sendError(res, 'A valid 10-digit mobile number is required.');

    // Check duplicate only if mobile actually changed
    if (digits !== normaliseMobile(emp.mobile)) {
      const dup = await Employee.findOne({
        company_id: req.user.company_id,
        mobile: { $regex: `${digits}$` },
        _id: { $ne: emp._id },
      }).lean();
      if (dup) return sendError(res, `Mobile ${digits} is already assigned to another staff member.`, 409);
    }
    emp.mobile = digits;
  }

  // ── Module access ───────────────────────────────────────────
  if (req.body.staff_app_access !== undefined) {
    const { ok, modules, error: accessErr } = parseAccessModules(req.body.staff_app_access);
    if (!ok) return sendError(res, accessErr);
    emp.staff_app_access = modules;
  }

  // ── Salary breakdown (merge — only update supplied fields) ──
  const salaryBd = parseSalaryBreakdown(req.body);
  if (Object.keys(salaryBd).length) {
    // salary_breakdown is a sub-doc; merge field by field
    Object.assign(emp.salary_breakdown, salaryBd);
    // Keep legacy flat salary in sync
    if (salaryBd.fixed_salary !== undefined) emp.salary = salaryBd.fixed_salary;
  }

  await emp.save();

  // If there is a linked User, sync active status
  if (emp.user_id && is_active !== undefined) {
    await User.findByIdAndUpdate(emp.user_id, { is_active: emp.is_active });
  }

  sendSuccess(res, { staff: emp.toObject() }, 'Staff member updated.');
}

/**
 * PATCH /api/staff-management/:id/toggle-active
 * Quick enable / disable without touching anything else.
 */
async function toggleStaffActive(req, res) {
  const emp = await Employee.findOne({
    _id: req.params.id,
    company_id: req.user.company_id,
  });
  if (!emp) return sendError(res, 'Staff member not found.', 404);

  emp.is_active = !emp.is_active;
  await emp.save();

  // Mirror on User account
  if (emp.user_id) {
    await User.findByIdAndUpdate(emp.user_id, { is_active: emp.is_active });
  }

  sendSuccess(res, { id: emp._id, is_active: emp.is_active },
    emp.is_active ? 'Staff member activated.' : 'Staff member deactivated.');
}

/**
 * DELETE /api/staff-management/:id
 * Permanently remove a staff member (also deactivates linked User).
 */
async function deleteStaff(req, res) {
  const emp = await Employee.findOne({
    _id: req.params.id,
    company_id: req.user.company_id,
  }).lean();
  if (!emp) return sendError(res, 'Staff member not found.', 404);

  // Deactivate linked User so they can no longer log in
  if (emp.user_id) {
    await User.findByIdAndUpdate(emp.user_id, { is_active: false });
  }

  await Employee.deleteOne({ _id: emp._id });
  sendSuccess(res, null, 'Staff member deleted.');
}

/**
 * GET /api/staff-management/modules
 * Return the full list of available Staff App modules.
 * Used by the frontend to build the access checkbox list.
 */
async function getAvailableModules(_req, res) {
  const moduleInfo = [
    { key: 'dashboard',     label: 'Dashboard' },
    { key: 'orders',        label: 'Orders' },
    { key: 'dispatches',    label: 'Dispatches' },
    { key: 'invoices',      label: 'Invoices' },
    { key: 'customers',     label: 'Customers' },
    { key: 'leads',         label: 'Leads' },
    { key: 'followups',     label: 'Follow-ups' },
    { key: 'quotations',    label: 'Quotations' },
    { key: 'products',      label: 'Products' },
    { key: 'finance',       label: 'Finance' },
    { key: 'notifications', label: 'Notifications' },
    { key: 'attendance',    label: 'Attendance' },
    { key: 'salary',        label: 'My Salary' },
  ];
  sendSuccess(res, { modules: moduleInfo });
}

module.exports = {
  listStaff,
  getStaff,
  addStaff,
  updateStaff,
  toggleStaffActive,
  deleteStaff,
  getAvailableModules,
};
