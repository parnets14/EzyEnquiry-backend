const mongoose = require('mongoose')

// ── Employee Schema ───────────────────────────────────────────
const employeeSchema = new mongoose.Schema({
  company_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  user_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'User',    default: null },
  emp_code:    { type: String, default: '' },
  name:        { type: String, required: true, trim: true },
  mobile:      { type: String, default: '' },
  email:       { type: String, default: '' },
  department:  { type: String, default: '' },
  designation: { type: String, default: '' },
  join_date:   { type: Date, default: null },
  salary:      { type: Number, default: 0 },
  is_active:   { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })

employeeSchema.index({ company_id: 1 })
const EmployeeModel = mongoose.model('Employee', employeeSchema)

// ── Attendance Schema ─────────────────────────────────────────
const attendanceSchema = new mongoose.Schema({
  company_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  date:        { type: Date, required: true },
  check_in:    { type: String, default: null },
  check_out:   { type: String, default: null },
  status:      { type: String, default: 'Present' },
  notes:       { type: String, default: '' },
}, { timestamps: { createdAt: 'created_at' } })

attendanceSchema.index({ employee_id: 1, date: 1 }, { unique: true })
const AttendanceModel = mongoose.model('Attendance', attendanceSchema)

// ── Salary Record Schema ──────────────────────────────────────
const salaryRecordSchema = new mongoose.Schema({
  company_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  employee_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  month:        { type: Number, required: true },
  year:         { type: Number, required: true },
  basic_salary: { type: Number, default: 0 },
  deductions:   { type: Number, default: 0 },
  net_salary:   { type: Number, default: 0 },
  payment_mode: { type: String, default: 'Bank' },
  payment_date: { type: Date, default: null },
  status:       { type: String, default: 'Pending' },
}, { timestamps: { createdAt: 'created_at' } })

salaryRecordSchema.index({ employee_id: 1, month: 1, year: 1 }, { unique: true })
const SalaryRecordModel = mongoose.model('SalaryRecord', salaryRecordSchema)

class Employee {
  static async findAll(company_id, filters = {}) {
    const { department, is_active, limit = 20, offset = 0 } = filters
    const query = { company_id }
    if (department)              query.department = department
    if (is_active !== undefined) query.is_active  = is_active !== 'false'
    return EmployeeModel.find(query)
      .populate('user_id', 'email role')
      .sort({ name: 1 })
      .skip(offset)
      .limit(limit)
      .lean()
  }

  static async count(company_id, filters = {}) {
    const { department, is_active } = filters
    const query = { company_id }
    if (department)              query.department = department
    if (is_active !== undefined) query.is_active  = is_active !== 'false'
    return EmployeeModel.countDocuments(query)
  }

  static async findById(id, company_id) {
    return EmployeeModel.findOne({ _id: id, company_id })
      .populate('user_id', 'email role')
      .lean()
  }

  static async create(company_id, data) {
    const { user_id, emp_code, name, mobile, email, department, designation, join_date, salary } = data
    const emp = await EmployeeModel.create({
      company_id,
      user_id:     user_id     || null,
      emp_code:    emp_code    || '',
      name, mobile: mobile || '', email: email || '',
      department:  department  || '',
      designation: designation || '',
      join_date:   join_date   || null,
      salary:      salary      || 0,
    })
    return emp.toObject()
  }

  static async update(id, company_id, data) {
    const { name, mobile, email, department, designation, join_date, salary, is_active } = data
    return EmployeeModel.findOneAndUpdate(
      { _id: id, company_id },
      { name, mobile, email, department, designation, join_date: join_date || null, salary, is_active: is_active !== false },
      { new: true }
    ).lean()
  }

  static async delete(id, company_id) {
    const result = await EmployeeModel.deleteOne({ _id: id, company_id })
    return result.deletedCount > 0
  }

  // ── Attendance ────────────────────────────────────────────
  static async findAttendance(company_id, filters = {}) {
    const { employee_id, date, limit = 50, offset = 0 } = filters
    const query = { company_id }
    if (employee_id) query.employee_id = employee_id
    if (date)        query.date        = new Date(date)
    return AttendanceModel.find(query)
      .populate('employee_id', 'name emp_code')
      .sort({ date: -1 })
      .skip(offset)
      .limit(limit)
      .lean()
  }

  static async markAttendance(company_id, data) {
    const { employee_id, date, check_in, check_out, status, notes } = data
    return AttendanceModel.findOneAndUpdate(
      { employee_id, date: new Date(date) },
      {
        $setOnInsert: { company_id },
        check_in:  check_in  || null,
        check_out: check_out || null,
        status:    status    || 'Present',
        notes:     notes     || '',
      },
      { upsert: true, new: true }
    ).lean()
  }

  // ── Salary ────────────────────────────────────────────────
  static async findSalaryRecords(company_id, filters = {}) {
    const { employee_id, month, year, limit = 20, offset = 0 } = filters
    const query = { company_id }
    if (employee_id) query.employee_id = employee_id
    if (month)       query.month       = parseInt(month)
    if (year)        query.year        = parseInt(year)
    return SalaryRecordModel.find(query)
      .populate('employee_id', 'name emp_code')
      .sort({ year: -1, month: -1 })
      .skip(offset)
      .limit(limit)
      .lean()
  }

  static async createSalaryRecord(company_id, data) {
    const { employee_id, month, year, basic_salary, deductions, payment_mode, payment_date } = data
    const net_salary = parseFloat(basic_salary) - parseFloat(deductions || 0)
    return SalaryRecordModel.findOneAndUpdate(
      { employee_id, month: parseInt(month), year: parseInt(year) },
      {
        $setOnInsert: { company_id },
        basic_salary: parseFloat(basic_salary),
        deductions:   parseFloat(deductions || 0),
        net_salary,
        payment_mode: payment_mode || 'Bank',
        payment_date: payment_date || null,
      },
      { upsert: true, new: true }
    ).lean()
  }

  static async paySalary(id, company_id, data) {
    const { payment_date, payment_mode } = data
    return SalaryRecordModel.findOneAndUpdate(
      { _id: id, company_id },
      {
        status:       'Paid',
        payment_date: payment_date ? new Date(payment_date) : new Date(),
        payment_mode: payment_mode || 'Bank',
      },
      { new: true }
    ).lean()
  }
}

module.exports = Employee
module.exports.EmployeeModel     = EmployeeModel
module.exports.AttendanceModel   = AttendanceModel
module.exports.SalaryRecordModel = SalaryRecordModel
