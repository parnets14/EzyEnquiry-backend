const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const Attendance = require('../../models/HR Management/Attendance');
const Employee   = require('../../models/HR Management/Employee');

/** GET /api/attendance */
async function listAttendance(req, res) {
  const { employee_id, date, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = { company_id: req.user.company_id };
  if (employee_id) query.employee_id = employee_id;
  if (date)        query.date        = new Date(date);

  const [total, attendance] = await Promise.all([
    Attendance.countDocuments(query),
    Attendance.find(query)
      .populate('employee_id', 'name emp_code')
      .sort({ date: -1 })
      .skip(offset)
      .limit(parseInt(limit))
      .lean(),
  ]);
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
      check_in:  check_in  || null,
      check_out: check_out || null,
      status:    status    || 'Present',
      notes:     notes     || '',
    },
    { upsert: true, new: true }
  ).lean();
  sendSuccess(res, att, 'Attendance marked.');
}

module.exports = { listAttendance, markAttendance };
