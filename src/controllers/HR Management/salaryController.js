const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const SalaryRecord = require('../../models/HR Management/SalaryRecord');

/** GET /api/salary */
async function listSalaryRecords(req, res) {
  const { employee_id, month, year, page = 1, limit = 200 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = { company_id: req.user.company_id };
  if (employee_id) query.employee_id = employee_id;
  if (month)       query.month       = parseInt(month);
  if (year)        query.year        = parseInt(year);

  const [total, salaries] = await Promise.all([
    SalaryRecord.countDocuments(query),
    SalaryRecord.find(query)
      .populate({ path: 'employee_id', select: 'name emp_code department designation branch salary' })
      .sort({ year: -1, month: -1 })
      .skip(offset)
      .limit(parseInt(limit))
      .lean(),
  ]);
  sendSuccess(res, { salaries, pagination: paginate(total, parseInt(page), parseInt(limit)) });
}

/** POST /api/salary */
async function createSalaryRecord(req, res) {
  const { employee_id, month, year } = req.body;
  if (!employee_id || !month || !year) return sendError(res, 'employee_id, month and year are required.');

  const {
    basic_salary, hra, travel_allow, special_allow, bonus,
    gross_salary, pf_deduction, pt_deduction, absent_deduction, other_deductions,
    total_deductions, net_salary,
    working_days, present_days, absent_days, leave_days, half_days,
    payment_mode, payment_date,
  } = req.body;

  const sal = await SalaryRecord.findOneAndUpdate(
    { employee_id, month: parseInt(month), year: parseInt(year) },
    {
      $setOnInsert: { company_id: req.user.company_id },
      basic_salary:     parseFloat(basic_salary    || 0),
      hra:              parseFloat(hra              || 0),
      travel_allow:     parseFloat(travel_allow     || 0),
      special_allow:    parseFloat(special_allow    || 0),
      bonus:            parseFloat(bonus            || 0),
      gross_salary:     parseFloat(gross_salary     || 0),
      pf_deduction:     parseFloat(pf_deduction     || 0),
      pt_deduction:     parseFloat(pt_deduction     || 0),
      absent_deduction: parseFloat(absent_deduction || 0),
      other_deductions: parseFloat(other_deductions || 0),
      total_deductions: parseFloat(total_deductions || 0),
      net_salary:       parseFloat(net_salary       || 0),
      working_days:     parseInt(working_days       || 26),
      present_days:     parseInt(present_days       || 0),
      absent_days:      parseInt(absent_days        || 0),
      leave_days:       parseInt(leave_days         || 0),
      half_days:        parseInt(half_days          || 0),
      payment_mode:     payment_mode || 'Bank',
      payment_date:     payment_date || null,
      processed_by:     req.user?.name || req.user?.email || 'System',
    },
    { upsert: true, new: true }
  ).populate({ path: 'employee_id', select: 'name emp_code department designation branch salary' }).lean();

  sendSuccess(res, sal, 'Salary record created.', 201);
}

/** PATCH /api/salary/:id/pay */
async function paySalary(req, res) {
  const { payment_date, payment_mode, payment_reference } = req.body;

  const sal = await SalaryRecord.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    {
      status:            'Paid',
      payment_date:      payment_date ? new Date(payment_date) : new Date(),
      payment_mode:      payment_mode      || 'Bank',
      payment_reference: payment_reference || '',
    },
    { new: true }
  ).populate({ path: 'employee_id', select: 'name emp_code department designation branch salary' }).lean();

  if (!sal) return sendError(res, 'Salary record not found.', 404);
  sendSuccess(res, sal, 'Salary marked as paid.');
}

module.exports = { listSalaryRecords, createSalaryRecord, paySalary };
