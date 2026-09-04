const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const Attendance = require('../../models/HR Management/Attendance');
const Employee   = require('../../models/HR Management/Employee');

// ── Standard shift policy ─────────────────────────────────────
// Sensible defaults for a 9:30–18:00 shift. Could be moved to a per-company
// setting later; centralised here so status derivation stays consistent.
const SHIFT = {
  start_minutes:      9 * 60 + 30,  // 09:30 — expected arrival
  late_grace_minutes: 15,           // arrivals after 09:45 are "Late"
  full_day_minutes:   8 * 60,       // 8h+ worked → full day
  half_day_minutes:   4 * 60,       // 4h–8h worked → "Half Day"; below → "Absent"
};

// Statuses the caller may set explicitly (skip auto-derivation for these).
const MANUAL_STATUSES = ['Absent', 'On Leave', 'Holiday', 'Week Off'];
const VALID_STATUSES  = Attendance.STATUSES;

// Normalise any date input to local midnight so one row === one calendar day.
function startOfDay(input) {
  const d = new Date(input);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Parse a clock string like "09:30 AM" / "18:05" into minutes-since-midnight.
function parseClock(t) {
  if (!t || typeof t !== 'string') return null;
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const mins = parseInt(m[2], 10);
  const ampm = m[3] ? m[3].toUpperCase() : null;
  if (ampm === 'PM' && hours !== 12) hours += 12;
  if (ampm === 'AM' && hours === 12) hours = 0;
  if (hours > 23 || mins > 59) return null;
  return hours * 60 + mins;
}

// Derive worked minutes and an auto status from clock-in/out, unless the caller
// explicitly set a manual status (Leave/Absent/Holiday/Week Off).
function deriveAttendance({ check_in, check_out, requestedStatus }) {
  if (requestedStatus && MANUAL_STATUSES.includes(requestedStatus)) {
    return { status: requestedStatus, work_minutes: 0 };
  }

  const inMin  = parseClock(check_in);
  const outMin = parseClock(check_out);

  // No usable check-in → fall back to requested status or Present.
  if (inMin === null) {
    return { status: requestedStatus && VALID_STATUSES.includes(requestedStatus) ? requestedStatus : 'Present', work_minutes: 0 };
  }

  const late = inMin > SHIFT.start_minutes + SHIFT.late_grace_minutes;

  // Checked in but not out yet → status reflects punctuality, hours pending.
  if (outMin === null) {
    return { status: late ? 'Late' : 'Present', work_minutes: 0 };
  }

  const worked = Math.max(0, outMin - inMin);

  let status;
  if (worked < SHIFT.half_day_minutes)      status = 'Absent';    // too short to count
  else if (worked < SHIFT.full_day_minutes) status = 'Half Day';
  else                                      status = late ? 'Late' : 'Present';

  return { status, work_minutes: worked };
}

const formatHours = (mins) => `${Math.floor(mins / 60)}h ${mins % 60}m`;

/** GET /api/employees/attendance/list */
async function listAttendance(req, res) {
  const { employee_id, date, month, year, department, branch, status, page = 1, limit = 200 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = { company_id: req.user.company_id };
  if (employee_id) query.employee_id = employee_id;
  if (date)        query.date        = startOfDay(date);
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

  // Filter by department/branch from populated fields + add readable work_hours.
  let attendance = results.map(r => ({
    ...r,
    work_hours: r.work_minutes ? formatHours(r.work_minutes) : null,
  }));
  if (department) attendance = attendance.filter(r => r.employee_id?.department === department);
  if (branch)     attendance = attendance.filter(r => r.employee_id?.branch     === branch);

  sendSuccess(res, { attendance, pagination: paginate(total, parseInt(page), parseInt(limit)) });
}

/** POST /api/employees/attendance/mark */
async function markAttendance(req, res) {
  const { employee_id, date, check_in, check_out, status, notes } = req.body;
  if (!employee_id || !date) return sendError(res, 'employee_id and date are required.');

  if (status && !VALID_STATUSES.includes(status)) {
    return sendError(res, `Invalid status. Allowed: ${VALID_STATUSES.join(', ')}.`);
  }

  // Employee must belong to the caller's company.
  const emp = await Employee.findOne({ _id: employee_id, company_id: req.user.company_id })
    .select('_id name join_date').lean();
  if (!emp) return sendError(res, 'Employee not found.', 404);

  const attDay = startOfDay(date);

  // Attendance only opens from the joining date onwards.
  if (emp.join_date) {
    const joinDay = startOfDay(emp.join_date);
    if (attDay < joinDay) {
      return sendError(res, `Attendance for ${emp.name} can only be marked from the joining date (${joinDay.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}) onwards.`);
    }
  }

  // No marking attendance for a date that hasn't happened yet.
  if (attDay > startOfDay(new Date())) {
    return sendError(res, 'Cannot mark attendance for a future date.');
  }

  const derived = deriveAttendance({ check_in, check_out, requestedStatus: status });

  const att = await Attendance.findOneAndUpdate(
    { employee_id, date: attDay },
    {
      $setOnInsert: { company_id: req.user.company_id },
      check_in:     check_in  ?? null,
      check_out:    check_out ?? null,
      status:       derived.status,
      work_minutes: derived.work_minutes,
      notes:        notes || '',
      marked_by:    req.user?.name || req.user?.email || 'System',
    },
    { upsert: true, new: true }
  ).populate({ path: 'employee_id', select: 'name emp_code department designation branch' }).lean();

  sendSuccess(res, { ...att, work_hours: att.work_minutes ? formatHours(att.work_minutes) : null }, 'Attendance marked.');
}

/** GET /api/employees/attendance/summary?date=YYYY-MM-DD */
async function getAttendanceSummary(req, res) {
  const { date } = req.query;
  if (!date) return sendError(res, 'date is required.');

  const day = startOfDay(date);

  // Only count employees who had joined on/before this date (avoids counting
  // future hires as absent). Employees without a join_date are always counted.
  const activeEmps = await Employee.find({
    company_id: req.user.company_id,
    is_active:  true,
    $or: [{ join_date: null }, { join_date: { $lte: new Date(new Date(day).setHours(23, 59, 59, 999)) } }],
  }).select('_id').lean();
  const activeIds = activeEmps.map(e => String(e._id));

  const records = await Attendance.find({ company_id: req.user.company_id, date: day }).lean();
  const byEmp = {};
  records.forEach(r => { byEmp[String(r.employee_id)] = r.status; });

  let present = 0, absent = 0, late = 0, halfDay = 0, onLeave = 0, holiday = 0;
  activeIds.forEach(id => {
    const st = byEmp[id];
    if (!st || st === 'Absent')                     absent++;
    else if (st === 'Present')                      present++;
    else if (st === 'Late')                         late++;
    else if (st === 'Half Day')                     halfDay++;
    else if (st === 'On Leave')                     onLeave++;
    else if (st === 'Holiday' || st === 'Week Off') holiday++;
    else                                            present++;
  });

  sendSuccess(res, {
    total: activeIds.length,
    present, absent: Math.max(0, absent), late, halfDay, onLeave, holiday,
  });
}

/** GET /api/employees/attendance/monthly?employee_id=&month=&year= */
// Per-employee attendance rollup for a month. Payroll uses this as the single
// source of truth instead of re-deriving counts on the client.
//
// Absent handling: we do NOT store a row for every unmarked day. Instead absent
// days are derived — any elapsed day (today or earlier) on/after the employee's
// join date that has no record counts as Absent. Today stays "open": if today
// is unmarked it is treated as absent in the live count but future days never
// count. This keeps the data clean and needs no daily cron job.
async function getMonthlyReport(req, res) {
  const { employee_id, month, year } = req.query;
  if (!month || !year) return sendError(res, 'month and year are required.');

  const m = parseInt(month), y = parseInt(year);
  const start = new Date(y, m - 1, 1);
  const end   = new Date(y, m, 0, 23, 59, 59);

  const today   = startOfDay(new Date());
  const daysInM = new Date(y, m, 0).getDate();

  // Which employees to include.
  const empQuery = { company_id: req.user.company_id, is_active: true };
  if (employee_id) empQuery._id = employee_id;
  const employees = await Employee.find(empQuery).select('_id join_date').lean();

  const recQuery = { company_id: req.user.company_id, date: { $gte: start, $lte: end } };
  if (employee_id) recQuery.employee_id = employee_id;
  const records = await Attendance.find(recQuery).lean();

  // Group records by employee and by day-of-month for quick lookup.
  const byEmp = {};
  for (const r of records) {
    const key = String(r.employee_id);
    if (!byEmp[key]) byEmp[key] = { markedDays: new Set(), rows: [] };
    byEmp[key].rows.push(r);
    byEmp[key].markedDays.add(new Date(r.date).getDate());
  }

  const report = employees.map(emp => {
    const key  = String(emp._id);
    const data = byEmp[key] || { markedDays: new Set(), rows: [] };

    const agg = { employee_id: key, present: 0, absent: 0, late: 0, half_day: 0, on_leave: 0, holiday: 0, work_minutes: 0, total_marked: 0 };
    for (const r of data.rows) {
      agg.total_marked++;
      agg.work_minutes += r.work_minutes || 0;
      switch (r.status) {
        case 'Present':  agg.present++;  break;
        case 'Late':     agg.late++;     break;
        case 'Half Day': agg.half_day++; break;
        case 'On Leave': agg.on_leave++; break;
        case 'Absent':   agg.absent++;   break;
        case 'Holiday':
        case 'Week Off': agg.holiday++;  break;
        default: agg.present++;
      }
    }

    // Derive absents for elapsed, eligible days that were never marked.
    const joinDay = emp.join_date ? startOfDay(emp.join_date) : null;
    let derivedAbsent = 0;
    for (let d = 1; d <= daysInM; d++) {
      const dayDate = startOfDay(new Date(y, m - 1, d));
      if (dayDate > today) break;                      // future day → still open
      if (joinDay && dayDate < joinDay) continue;      // before joining → not applicable
      if (data.markedDays.has(d)) continue;            // already has a record
      derivedAbsent++;
    }
    agg.absent += derivedAbsent;

    return {
      ...agg,
      // Payable days: full days + half credit for half-days. Leave is paid; holiday/week-off excluded.
      payable_days: agg.present + agg.late + agg.on_leave + agg.half_day * 0.5,
      work_hours: formatHours(agg.work_minutes),
    };
  });

  sendSuccess(res, { month: m, year: y, report });
}

module.exports = { listAttendance, markAttendance, getAttendanceSummary, getMonthlyReport };
