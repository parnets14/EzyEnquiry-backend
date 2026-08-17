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
  branch:      { type: String, default: '' },
  join_date:   { type: Date, default: null },
  salary:      { type: Number, default: 0 },
  pan:         { type: String, default: '' },
  address:     { type: String, default: '' },
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
  company_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  employee_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  month:          { type: Number, required: true },
  year:           { type: Number, required: true },
  basic_salary:   { type: Number, default: 0 },
  hra:            { type: Number, default: 0 },
  travel_allow:   { type: Number, default: 0 },
  special_allow:  { type: Number, default: 0 },
  bonus:          { type: Number, default: 0 },
  gross_salary:   { type: Number, default: 0 },
  pf_deduction:   { type: Number, default: 0 },
  pt_deduction:   { type: Number, default: 0 },
  absent_deduction: { type: Number, default: 0 },
  other_deductions: { type: Number, default: 0 },
  total_deductions: { type: Number, default: 0 },
  net_salary:     { type: Number, default: 0 },
  working_days:   { type: Number, default: 26 },
  present_days:   { type: Number, default: 0 },
  absent_days:    { type: Number, default: 0 },
  leave_days:     { type: Number, default: 0 },
  half_days:      { type: Number, default: 0 },
  payment_mode:   { type: String, default: 'Bank' },
  payment_date:   { type: Date, default: null },
  payment_reference: { type: String, default: '' },
  status:         { type: String, default: 'Pending' },
  processed_by:   { type: String, default: '' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })

salaryRecordSchema.index({ employee_id: 1, month: 1, year: 1 }, { unique: true })
const SalaryRecordModel = mongoose.model('SalaryRecord', salaryRecordSchema)

class Employee {
  static async findAll(company_id, filters = {}) {
    const { department, branch, is_active, limit = 200, offset = 0 } = filters
    const query = { company_id }
    if (department)              query.department = department
    if (branch)                  query.branch     = branch
    if (is_active !== undefined) query.is_active  = is_active !== 'false'
    return EmployeeModel.find(query)
      .populate('user_id', 'email role')
      .sort({ name: 1 })
      .skip(offset)
      .limit(limit)
      .lean()
  }

  static async count(company_id, filters = {}) {
    const { department, branch, is_active } = filters
    const query = { company_id }
    if (department)              query.department = department
    if (branch)                  query.branch     = branch
    if (is_active !== undefined) query.is_active  = is_active !== 'false'
    return EmployeeModel.countDocuments(query)
  }

  static async findById(id, company_id) {
    return EmployeeModel.findOne({ _id: id, company_id })
      .populate('user_id', 'email role')
      .lean()
  }

  static async create(company_id, data) {
    const { user_id, emp_code, name, mobile, email, department, designation, branch, join_date, salary, pan, address } = data
    const emp = await EmployeeModel.create({
      company_id,
      user_id:     user_id     || null,
      emp_code:    emp_code    || '',
      name, mobile: mobile || '', email: email || '',
      department:  department  || '',
      designation: designation || '',
      branch:      branch      || '',
      join_date:   join_date   || null,
      salary:      salary      || 0,
      pan:         pan         || '',
      address:     address     || '',
    })
    return emp.toObject()
  }

  static async update(id, company_id, data) {
    const { name, mobile, email, department, designation, branch, join_date, salary, pan, address, is_active } = data
    return EmployeeModel.findOneAndUpdate(
      { _id: id, company_id },
      { name, mobile, email, department, designation, branch: branch || '', join_date: join_date || null, salary, pan: pan || '', address: address || '', is_active: is_active !== false },
      { new: true }
    ).lean()
  }

  static async delete(id, company_id) {
    const result = await EmployeeModel.deleteOne({ _id: id, company_id })
    return result.deletedCount > 0
  }

  // ── Attendance ────────────────────────────────────────────
  static async findAttendance(company_id, filters = {}) {
    const { employee_id, date, month, year, department, branch, status, limit = 50, offset = 0 } = filters
    const query = { company_id }
    if (employee_id) query.employee_id = employee_id
    if (date)        query.date        = new Date(date)
    if (month && year) {
      const start = new Date(parseInt(year), parseInt(month) - 1, 1)
      const end   = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59)
      query.date  = { $gte: start, $lte: end }
    }
    if (status) query.status = status

    let q = AttendanceModel.find(query)
      .populate({ path: 'employee_id', select: 'name emp_code department designation branch is_active' })
      .sort({ date: -1 })
      .skip(offset)
      .limit(limit)
      .lean()

    let results = await q

    // Filter by department/branch (populated fields)
    if (department) results = results.filter(r => r.employee_id?.department === department)
    if (branch)     results = results.filter(r => r.employee_id?.branch === branch)

    return results
  }

  static async countAttendance(company_id, filters = {}) {
    const { employee_id, date, month, year, status } = filters
    const query = { company_id }
    if (employee_id) query.employee_id = employee_id
    if (date)        query.date        = new Date(date)
    if (month && year) {
      const start = new Date(parseInt(year), parseInt(month) - 1, 1)
      const end   = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59)
      query.date  = { $gte: start, $lte: end }
    }
    if (status) query.status = status
    return AttendanceModel.countDocuments(query)
  }

  static async markAttendance(company_id, data) {
    const { employee_id, date, check_in, check_out, status, notes, updated_by } = data
    return AttendanceModel.findOneAndUpdate(
      { employee_id, date: new Date(date) },
      {
        $setOnInsert: { company_id },
        check_in:   check_in   ?? null,
        check_out:  check_out  ?? null,
        status:     status     || 'Present',
        notes:      notes      || '',
        updated_by: updated_by || '',
        updated_at: new Date(),
      },
      { upsert: true, new: true }
    ).populate({ path: 'employee_id', select: 'name emp_code department designation branch' }).lean()
  }

  static async getAttendanceSummaryForDate(company_id, date, activeEmployeeIds) {
    const d = new Date(date)
    const records = await AttendanceModel.find({ company_id, date: d }).lean()
    const byEmp = {}
    records.forEach(r => { byEmp[String(r.employee_id)] = r.status })

    let present = 0, absent = 0, late = 0, halfDay = 0, onLeave = 0
    activeEmployeeIds.forEach(id => {
      const st = byEmp[String(id)]
      if (!st)                st === undefined && absent++
      else if (st === 'Present') present++
      else if (st === 'Late')    late++
      else if (st === 'Half Day') halfDay++
      else if (st === 'On Leave') onLeave++
      else if (st === 'Absent')   absent++
      else present++ // any other recorded status counts as present
    })
    // recalc absent properly
    absent = activeEmployeeIds.length - present - late - halfDay - onLeave
    return { total: activeEmployeeIds.length, present, absent: Math.max(0, absent), late, halfDay, onLeave }
  }

  // ── Salary ────────────────────────────────────────────────
  static async findSalaryRecords(company_id, filters = {}) {
    const { employee_id, month, year, limit = 20, offset = 0 } = filters
    const query = { company_id }
    if (employee_id) query.employee_id = employee_id
    if (month)       query.month       = parseInt(month)
    if (year)        query.year        = parseInt(year)
    return SalaryRecordModel.find(query)
      .populate({ path: 'employee_id', select: 'name emp_code department designation branch salary' })
      .sort({ year: -1, month: -1 })
      .skip(offset)
      .limit(limit)
      .lean()
  }

  static async createSalaryRecord(company_id, data) {
    const {
      employee_id, month, year,
      basic_salary, hra, travel_allow, special_allow, bonus,
      gross_salary, pf_deduction, pt_deduction, absent_deduction, other_deductions,
      total_deductions, net_salary,
      working_days, present_days, absent_days, leave_days, half_days,
      payment_mode, payment_date, processed_by,
    } = data

    return SalaryRecordModel.findOneAndUpdate(
      { employee_id, month: parseInt(month), year: parseInt(year) },
      {
        $setOnInsert: { company_id },
        basic_salary:     parseFloat(basic_salary   || 0),
        hra:              parseFloat(hra             || 0),
        travel_allow:     parseFloat(travel_allow    || 0),
        special_allow:    parseFloat(special_allow   || 0),
        bonus:            parseFloat(bonus           || 0),
        gross_salary:     parseFloat(gross_salary    || 0),
        pf_deduction:     parseFloat(pf_deduction    || 0),
        pt_deduction:     parseFloat(pt_deduction    || 0),
        absent_deduction: parseFloat(absent_deduction|| 0),
        other_deductions: parseFloat(other_deductions|| 0),
        total_deductions: parseFloat(total_deductions|| 0),
        net_salary:       parseFloat(net_salary      || 0),
        working_days:     parseInt(working_days      || 26),
        present_days:     parseInt(present_days      || 0),
        absent_days:      parseInt(absent_days       || 0),
        leave_days:       parseInt(leave_days        || 0),
        half_days:        parseInt(half_days         || 0),
        payment_mode:     payment_mode || 'Bank',
        payment_date:     payment_date || null,
        processed_by:     processed_by || '',
      },
      { upsert: true, new: true }
    ).populate({ path: 'employee_id', select: 'name emp_code department designation branch salary' }).lean()
  }

  static async paySalary(id, company_id, data) {
    const { payment_date, payment_mode, payment_reference } = data
    return SalaryRecordModel.findOneAndUpdate(
      { _id: id, company_id },
      {
        status:            'Paid',
        payment_date:      payment_date ? new Date(payment_date) : new Date(),
        payment_mode:      payment_mode || 'Bank',
        payment_reference: payment_reference || '',
      },
      { new: true }
    ).populate({ path: 'employee_id', select: 'name emp_code department designation branch salary' }).lean()
  }
}

module.exports = Employee
module.exports.EmployeeModel     = EmployeeModel
module.exports.AttendanceModel   = AttendanceModel
module.exports.SalaryRecordModel = SalaryRecordModel
