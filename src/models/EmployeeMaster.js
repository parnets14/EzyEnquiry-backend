const mongoose = require('mongoose')

// ── Department Schema ──────────────────────────────────────────
const departmentSchema = new mongoose.Schema({
  company_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  dept_code:   { type: String, default: '' },
  name:        { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  is_active:   { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })

departmentSchema.index({ company_id: 1 })
const DepartmentModel = mongoose.model('Department', departmentSchema)

// ── Designation Schema ─────────────────────────────────────────
const designationSchema = new mongoose.Schema({
  company_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  department_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
  desig_code:    { type: String, default: '' },
  name:          { type: String, required: true, trim: true },
  description:   { type: String, default: '' },
  is_active:     { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })

designationSchema.index({ company_id: 1, department_id: 1 })
const DesignationModel = mongoose.model('Designation', designationSchema)

// ── Static methods ─────────────────────────────────────────────
class EmployeeMaster {

  // ── Departments ──────────────────────────────────────────────
  static async listDepartments(company_id) {
    return DepartmentModel.find({ company_id }).sort({ name: 1 }).lean()
  }

  static async createDepartment(company_id, data) {
    const { name, description, is_active } = data
    // Auto-generate dept_code: DEP-001, DEP-002...
    const count = await DepartmentModel.countDocuments({ company_id })
    const dept_code = `DEP-${String(count + 1).padStart(3, '0')}`
    const dept = await DepartmentModel.create({
      company_id, dept_code, name, description: description || '',
      is_active: is_active !== false,
    })
    return dept.toObject()
  }

  static async updateDepartment(id, company_id, data) {
    const { name, description, is_active } = data
    return DepartmentModel.findOneAndUpdate(
      { _id: id, company_id },
      { name, description: description || '', is_active: is_active !== false },
      { new: true }
    ).lean()
  }

  static async deleteDepartment(id, company_id) {
    // Soft-check: don't delete if designations exist under it
    const designationCount = await DesignationModel.countDocuments({ department_id: id, company_id })
    if (designationCount > 0) return { deleted: false, reason: 'Department has designations. Delete designations first.' }
    const result = await DepartmentModel.deleteOne({ _id: id, company_id })
    return { deleted: result.deletedCount > 0 }
  }

  // ── Designations ─────────────────────────────────────────────
  static async listDesignations(company_id, filters = {}) {
    const { department_id } = filters
    const query = { company_id }
    if (department_id) query.department_id = department_id
    return DesignationModel.find(query)
      .populate({ path: 'department_id', select: 'name dept_code' })
      .sort({ name: 1 })
      .lean()
  }

  static async createDesignation(company_id, data) {
    const { department_id, name, description, is_active } = data
    const count = await DesignationModel.countDocuments({ company_id })
    const desig_code = `DES-${String(count + 1).padStart(3, '0')}`
    const desig = await DesignationModel.create({
      company_id, department_id, desig_code, name,
      description: description || '',
      is_active: is_active !== false,
    })
    return DesignationModel.findById(desig._id)
      .populate({ path: 'department_id', select: 'name dept_code' })
      .lean()
  }

  static async updateDesignation(id, company_id, data) {
    const { department_id, name, description, is_active } = data
    return DesignationModel.findOneAndUpdate(
      { _id: id, company_id },
      { department_id, name, description: description || '', is_active: is_active !== false },
      { new: true }
    ).populate({ path: 'department_id', select: 'name dept_code' }).lean()
  }

  static async deleteDesignation(id, company_id) {
    const result = await DesignationModel.deleteOne({ _id: id, company_id })
    return { deleted: result.deletedCount > 0 }
  }
}

module.exports = EmployeeMaster
module.exports.DepartmentModel  = DepartmentModel
module.exports.DesignationModel = DesignationModel
