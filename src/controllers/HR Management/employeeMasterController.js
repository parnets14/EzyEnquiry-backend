const { sendSuccess, sendError } = require('../../utils/helpers');
const Department = require('../../models/HR Management/Department');
const Designation = require('../../models/HR Management/Designation');

// ── Auto-generate a short code ─────────────────────────────────
const makeCode = (prefix, name) => {
  const slug = (name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  const rnd  = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${slug || rnd}`;
};

// ══════════════════════════════════════════════════════════════
// DEPARTMENTS
// ══════════════════════════════════════════════════════════════

/** GET /api/employee-master/departments */
async function listDepartments(req, res) {
  const departments = await Department.find({ company_id: req.user.company_id })
    .sort({ name: 1 })
    .lean();
  sendSuccess(res, { departments });
}

/** POST /api/employee-master/departments */
async function createDepartment(req, res) {
  const { name, description, is_active } = req.body;
  if (!name || !name.trim()) return sendError(res, 'Department name is required.');

  // Check duplicate within company
  const existing = await Department.findOne({
    company_id: req.user.company_id,
    name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
  });
  if (existing) return sendError(res, `Department "${name.trim()}" already exists.`, 409);

  const dept = await Department.create({
    company_id:  req.user.company_id,
    dept_code:   makeCode('DEPT', name),
    name:        name.trim(),
    description: description || '',
    is_active:   is_active !== false,
  });
  sendSuccess(res, dept, 'Department created.', 201);
}

/** PUT /api/employee-master/departments/:id */
async function updateDepartment(req, res) {
  const { name, description, is_active } = req.body;
  const update = {};
  if (name        !== undefined) update.name        = name.trim();
  if (description !== undefined) update.description = description;
  if (is_active   !== undefined) update.is_active   = is_active !== false;

  const dept = await Department.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    update,
    { new: true }
  ).lean();
  if (!dept) return sendError(res, 'Department not found.', 404);
  sendSuccess(res, dept, 'Department updated.');
}

/** DELETE /api/employee-master/departments/:id */
async function deleteDepartment(req, res) {
  // Prevent deletion if designations exist under it
  const count = await Designation.countDocuments({
    company_id:    req.user.company_id,
    department_id: req.params.id,
  });
  if (count > 0) return sendError(res, `Cannot delete: ${count} designation(s) exist under this department. Delete them first.`, 409);

  const result = await Department.deleteOne({ _id: req.params.id, company_id: req.user.company_id });
  if (result.deletedCount === 0) return sendError(res, 'Department not found.', 404);
  sendSuccess(res, null, 'Department deleted.');
}

// ══════════════════════════════════════════════════════════════
// DESIGNATIONS
// ══════════════════════════════════════════════════════════════

/** GET /api/employee-master/designations */
async function listDesignations(req, res) {
  const query = { company_id: req.user.company_id };
  if (req.query.department_id) query.department_id = req.query.department_id;

  const designations = await Designation.find(query)
    .populate({ path: 'department_id', select: 'name dept_code' })
    .sort({ name: 1 })
    .lean();
  sendSuccess(res, { designations });
}

/** POST /api/employee-master/designations */
async function createDesignation(req, res) {
  const { department_id, name, description, is_active } = req.body;
  if (!department_id) return sendError(res, 'Department is required.');
  if (!name || !name.trim()) return sendError(res, 'Designation name is required.');

  // Verify department belongs to this company
  const dept = await Department.findOne({ _id: department_id, company_id: req.user.company_id });
  if (!dept) return sendError(res, 'Department not found.', 404);

  // Check duplicate
  const existing = await Designation.findOne({
    company_id: req.user.company_id,
    department_id,
    name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
  });
  if (existing) return sendError(res, `Designation "${name.trim()}" already exists in this department.`, 409);

  const desig = await Designation.create({
    company_id:    req.user.company_id,
    department_id,
    desig_code:    makeCode('DESIG', name),
    name:          name.trim(),
    description:   description || '',
    is_active:     is_active !== false,
  });

  const populated = await Designation.findById(desig._id)
    .populate({ path: 'department_id', select: 'name dept_code' })
    .lean();
  sendSuccess(res, populated, 'Designation created.', 201);
}

/** PUT /api/employee-master/designations/:id */
async function updateDesignation(req, res) {
  const { department_id, name, description, is_active } = req.body;
  const update = {};
  if (department_id !== undefined) update.department_id = department_id;
  if (name          !== undefined) update.name          = name.trim();
  if (description   !== undefined) update.description   = description;
  if (is_active     !== undefined) update.is_active     = is_active !== false;

  const desig = await Designation.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    update,
    { new: true }
  ).populate({ path: 'department_id', select: 'name dept_code' }).lean();
  if (!desig) return sendError(res, 'Designation not found.', 404);
  sendSuccess(res, desig, 'Designation updated.');
}

/** DELETE /api/employee-master/designations/:id */
async function deleteDesignation(req, res) {
  const result = await Designation.deleteOne({ _id: req.params.id, company_id: req.user.company_id });
  if (result.deletedCount === 0) return sendError(res, 'Designation not found.', 404);
  sendSuccess(res, null, 'Designation deleted.');
}

module.exports = {
  listDepartments, createDepartment, updateDepartment, deleteDepartment,
  listDesignations, createDesignation, updateDesignation, deleteDesignation,
};
