const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const Employee   = require('../../models/HR Management/Employee');
const Attendance = require('../../models/HR Management/Attendance');

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
    branch:      req.body.branch      || '',
    join_date:   req.body.join_date   || null,
    salary:      req.body.salary      || 0,
    pan:         req.body.pan         || '',
    address:     req.body.address     || '',
  });
  sendSuccess(res, emp, 'Employee created.', 201);
}

/** PUT /api/employees/:id */
async function updateEmployee(req, res) {
  const { name, mobile, email, department, designation, branch, join_date, salary, pan, address, is_active } = req.body;
  const update = {};
  if (name        !== undefined) update.name        = name;
  if (mobile      !== undefined) update.mobile      = mobile;
  if (email       !== undefined) update.email       = email;
  if (department  !== undefined) update.department  = department;
  if (designation !== undefined) update.designation = designation;
  if (branch      !== undefined) update.branch      = branch      || '';
  if (join_date   !== undefined) update.join_date   = join_date   || null;
  if (salary      !== undefined) update.salary      = salary;
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

module.exports = { listEmployees, getEmployee, createEmployee, updateEmployee, deleteEmployee };
