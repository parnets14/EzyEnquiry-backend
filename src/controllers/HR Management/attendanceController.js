const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const Attendance = require('../../models/HR Management/Attendance');
const Employee   = require('../../models/HR Management/Employee');

/** GET /api/attendance */
async function listAttendance(req, res) {
  const { employee_id, date, month, year, department, branch, status, page = 1, limit = 200 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = { company_id: req.user.company_id };
  if (employee_id) query.employee_id = employee_id;
  if (date)        query.date        = new Date(date);
  if (month && year) {
    const start = new Date(parseInt(year), parseInt(month) - 1, 1);
    const end   = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59);
    query.date  = { $gte: start, $lte: end };
  }
  if (status) query.status = status;

  const [total, results] = await Promise.all([
    Attendance.countDocuments(query),
    Attendance.find(query)
      .populate({ path: 'employee_id', select: 'name emp_code department designation branch is_active' })
      .sort({ date: -1 })
      .skip(offset)
      .limit(parseInt(limit))
      .lean(),
  ]);

  // Filter by department/branch from populated fields
  let attendance = results;
  if (department) attendance = attendance.filter(r => r.employee_id?.department === department);
  if (branch)     attendance = attendance.filter(r => r.employee_id?.branch     === branch);

  sendSuccess(res, { attendance, pagination: paginate(total, parseInt(page), parseInt(limit)) });
}

/** POST /api/attendance/mark */
async function markAttendance(req, res) {
  const { employee_id, date, check_in, check_out, status, notes } = req.body;
  if (!employee_id || !date) return sendError(res, 'employee_id and date are required.');

  const att = await Attendance.findOneAndUpdate(
    { employee_id, date: new Date(date) },
    {
      $setOnInsert: { company_id: req.user.company_id },
      check_in:  check_in  ?? null,
      check_out: check_out ?? null,
      status:    status    || 'Present',
      notes:     notes     || '',
    },
    { upsert: true, new: true }
  ).populate({ path: 'employee_id', select: 'name emp_code department designation branch' }).lean();
  sendSuccess(res, att, 'Attendance marked.');
}

/** GET /api/attendance/summary?date=YYYY-MM-DD */
async function getAttendanceSummary(req, res) {
  const { date } = req.query;
  if (!date) return sendError(res, 'date is required.');

  const activeEmps = await Employee.find({ company_id: req.user.company_id, is_active: true })
    .select('_id').lean();
  const activeIds = activeEmps.map(e => e._id);

  const d = new Date(date);
  const records = await Attendance.find({ company_id: req.user.company_id, date: d }).lean();
  const byEmp = {};
  records.forEach(r => { byEmp[String(r.employee_id)] = r.status; });

  let present = 0, absent = 0, late = 0, halfDay = 0, onLeave = 0;
  activeIds.forEach(id => {
    const st = byEmp[String(id)];
    if (!st || st === 'Absent')  absent++;
    else if (st === 'Present')   present++;
    else if (st === 'Late')      late++;
    else if (st === 'Half Day')  halfDay++;
    else if (st === 'On Leave')  onLeave++;
    else                         present++;
  });

  sendSuccess(res, { total: activeIds.length, present, absent: Math.max(0, absent), late, halfDay, onLeave });
}

module.exports = { listAttendance, markAttendance, getAttendanceSummary };
