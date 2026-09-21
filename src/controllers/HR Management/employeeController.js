const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const Employee   = require('../../models/HR Management/Employee');
const Attendance = require('../../models/HR Management/Attendance');
const Sale       = require('../../models/Finance Management/Sale');

/**
 * Normalise incentive slabs from the request into a clean, sorted array.
 * Accepts [{ sales_amount, incentive_pct }] (numbers or numeric strings).
 * Drops invalid/empty rows and sorts ascending by sales_amount.
 */
function sanitizeSlabs(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(s => ({
      sales_amount:  Number(s?.sales_amount),
      incentive_pct: Number(s?.incentive_pct),
    }))
    .filter(s => isFinite(s.sales_amount) && s.sales_amount > 0 &&
                 isFinite(s.incentive_pct) && s.incentive_pct >= 0)
    .sort((a, b) => a.sales_amount - b.sales_amount);
}

/**
 * Normalise Discount Authorized Access rows from the request.
 * Accepts [{ product_id, product_name, product_code, max_discount_pct }].
 * Keeps only rows with a valid product_id and a max_discount_pct in 0–100.
 * De-duplicates by product_id (last row wins).
 */
function sanitizeDiscountAuth(raw) {
  if (!Array.isArray(raw)) return [];
  const byProduct = new Map();
  for (const r of raw) {
    const product_id = r?.product_id;
    if (!product_id) continue;
    const pct = Number(r?.max_discount_pct);
    if (!isFinite(pct) || pct < 0) continue;
    byProduct.set(String(product_id), {
      product_id,
      product_name:     r?.product_name || '',
      product_code:     r?.product_code || '',
      max_discount_pct: Math.min(100, pct),
    });
  }
  return Array.from(byProduct.values());
}

/**
 * Incentive amount for a given sales total using the threshold model:
 * apply the % of the highest slab whose sales_amount the total has reached.
 * @param {number} salesTotal
 * @param {Array<{sales_amount:number, incentive_pct:number}>} slabs
 * @returns {{ pct:number, amount:number }}
 */
function calcIncentive(salesTotal, slabs = []) {
  const total = Number(salesTotal) || 0;
  const sorted = sanitizeSlabs(slabs);
  let pct = 0;
  for (const slab of sorted) {
    if (total >= slab.sales_amount) pct = slab.incentive_pct;
  }
  return { pct, amount: Math.round((total * pct) / 100 * 100) / 100 };
}

/**
 * Sum a staff member's own sales (Sale.grand_total where created_by = userId)
 * for a given month, and compute the earned incentive from their slabs.
 *
 * @param {ObjectId} companyId
 * @param {ObjectId} userId        the staff member's linked User id
 * @param {Array}    slabs         incentive_slabs from the Employee
 * @param {Date}     [when=now]    any date within the target month
 * @returns {Promise<{ periodLabel, from, to, monthSales, pct, amount, slabs }>}
 */
async function computeStaffIncentive(companyId, userId, slabs = [], when = new Date()) {
  const from = new Date(when.getFullYear(), when.getMonth(), 1);
  const to   = new Date(when.getFullYear(), when.getMonth() + 1, 1);

  let monthSales = 0;
  if (userId) {
    const rows = await Sale.aggregate([
      {
        $match: {
          company_id: new (require('mongoose').Types.ObjectId)(String(companyId)),
          created_by: new (require('mongoose').Types.ObjectId)(String(userId)),
          sale_status: { $ne: 'Cancelled' },
          $or: [
            { sale_date: { $gte: from, $lt: to } },
            { sale_date: null, created_at: { $gte: from, $lt: to } },
          ],
        },
      },
      { $group: { _id: null, total: { $sum: { $ifNull: ['$grand_total', '$total_amount'] } } } },
    ]);
    monthSales = rows[0]?.total || 0;
  }

  const { pct, amount } = calcIncentive(monthSales, slabs);
  return {
    periodLabel: from.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
    from, to,
    monthSales,
    pct,
    amount,
    slabs: sanitizeSlabs(slabs),
  };
}

/**
 * GET /api/employees/:id/incentive
 * Returns the staff member's current-month sales + earned incentive.
 */
async function getEmployeeIncentive(req, res) {
  const emp = await Employee.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
  if (!emp) return sendError(res, 'Employee not found.', 404);

  const summary = await computeStaffIncentive(
    req.user.company_id,
    emp.user_id,
    emp.incentive_slabs,
  );
  sendSuccess(res, { salary: emp.salary || 0, ...summary });
}

/**
 * GET /api/employees/admin/all  (Super Admin only)
 * Returns every employee across ALL companies, each joined with its company's
 * name + biz_type, so the CRM can group staff by business.
 */
async function listAllEmployees(req, res) {
  const { is_active } = req.query;
  const query = {};
  if (is_active !== undefined) query.is_active = is_active !== 'false';

  const employees = await Employee.find(query)
    .populate('company_id', 'name biz_type company_code')
    .populate('user_id', 'email role')
    .sort({ created_at: -1 })
    .lean();

  const rows = employees.map(e => ({
    ...e,
    company_name:  e.company_id?.name || '—',
    biz_type:      e.company_id?.biz_type || 'Other',
    company_code:  e.company_id?.company_code || '',
    company_id:    e.company_id?._id || e.company_id || null,
  }));

  sendSuccess(res, { employees: rows, total: rows.length });
}

/** GET /api/employees */
async function listEmployees(req, res) {
  const { department, branch, is_active, page = 1, limit = 200 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = { company_id: req.user.company_id };
  if (department)              query.department = department;
  if (branch)                  query.branch     = branch;
  if (is_active !== undefined) query.is_active  = is_active !== 'false';

  const [total, employees] = await Promise.all([
    Employee.countDocuments(query),
    Employee.find(query)
      .populate('user_id', 'email role')
      .sort({ name: 1 })
      .skip(offset)
      .limit(parseInt(limit))
      .lean(),
  ]);
  sendSuccess(res, { employees, pagination: paginate(total, parseInt(page), parseInt(limit)) });
}

/** GET /api/employees/:id */
async function getEmployee(req, res) {
  const emp = await Employee.findOne({ _id: req.params.id, company_id: req.user.company_id })
    .populate('user_id', 'email role')
    .lean();
  if (!emp) return sendError(res, 'Employee not found.', 404);

  const attendance = await Attendance.find({
    company_id:  req.user.company_id,
    employee_id: req.params.id,
  }).sort({ date: -1 }).limit(30).lean();

  sendSuccess(res, { ...emp, attendance });
}

/** POST /api/employees */
async function createEmployee(req, res) {
  const { name } = req.body;
  if (!name) return sendError(res, 'Employee name is required.');

  const emp = await Employee.create({
    company_id:  req.user.company_id,
    user_id:     req.body.user_id     || null,
    emp_code:    req.body.emp_code    || '',
    name,
    mobile:      req.body.mobile      || '',
    email:       req.body.email       || '',
    department:  req.body.department  || '',
    designation: req.body.designation || '',
    role_access: req.body.role_access || '',
    branch:      req.body.branch      || '',
    join_date:   req.body.join_date   || null,
    salary:      req.body.salary      || 0,
    incentive_slabs: sanitizeSlabs(req.body.incentive_slabs),
    discount_authorizations: sanitizeDiscountAuth(req.body.discount_authorizations),
    pan:         req.body.pan         || '',
    address:     req.body.address     || '',
  });
  sendSuccess(res, emp, 'Employee created.', 201);
}

/** PUT /api/employees/:id */
async function updateEmployee(req, res) {
  const { name, mobile, email, department, designation, role_access, branch, join_date, salary, incentive_slabs, discount_authorizations, pan, address, is_active } = req.body;
  const update = {};
  if (name        !== undefined) update.name        = name;
  if (mobile      !== undefined) update.mobile      = mobile;
  if (email       !== undefined) update.email       = email;
  if (department  !== undefined) update.department  = department;
  if (designation !== undefined) update.designation = designation;
  if (role_access !== undefined) update.role_access = role_access || '';
  if (branch      !== undefined) update.branch      = branch      || '';
  if (join_date   !== undefined) update.join_date   = join_date   || null;
  if (salary      !== undefined) update.salary      = salary;
  if (incentive_slabs !== undefined) update.incentive_slabs = sanitizeSlabs(incentive_slabs);
  if (discount_authorizations !== undefined) update.discount_authorizations = sanitizeDiscountAuth(discount_authorizations);
  if (pan         !== undefined) update.pan         = pan         || '';
  if (address     !== undefined) update.address     = address     || '';
  if (is_active   !== undefined) update.is_active   = is_active !== false;

  const emp = await Employee.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    update,
    { new: true }
  ).lean();
  if (!emp) return sendError(res, 'Employee not found.', 404);
  sendSuccess(res, emp, 'Employee updated.');
}

/** DELETE /api/employees/:id */
async function deleteEmployee(req, res) {
  const result = await Employee.deleteOne({ _id: req.params.id, company_id: req.user.company_id });
  if (result.deletedCount === 0) return sendError(res, 'Employee not found.', 404);
  sendSuccess(res, null, 'Employee deleted.');
}

module.exports = { listEmployees, listAllEmployees, getEmployee, createEmployee, updateEmployee, deleteEmployee, getEmployeeIncentive, calcIncentive, sanitizeSlabs, sanitizeDiscountAuth, computeStaffIncentive };
