const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const SalaryRecord = require('../../models/HR Management/SalaryRecord');

/** GET /api/salary */
async function listSalaryRecords(req, res) {
  const { employee_id, month, year, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = { company_id: req.user.company_id };
  if (employee_id) query.employee_id = employee_id;
  if (month)       query.month       = parseInt(month);
  if (year)        query.year        = parseInt(year);

  const [total, salaries] = await Promise.all([
    SalaryRecord.countDocuments(query),
    SalaryRecord.find(query)
      .populate('employee_id', 'name emp_code')
      .sort({ year: -1, month: -1 })
      .skip(offset)
      .limit(parseInt(limit))
      .lean(),
  ]);
  sendSuccess(res, { salaries, pagination: paginate(total, parseInt(page), parseInt(limit)) });
}

/** POST /api/salary */
async function createSalaryRecord(req, res) {
  const { employee_id, month, year, basic_salary } = req.body;
  if (!employee_id || !month || !year || !basic_salary)
    return sendError(res, 'employee_id, month, year and basic_salary are required.');

  const net_salary = parseFloat(basic_salary) - parseFloat(req.body.deductions || 0);

  const sal = await SalaryRecord.findOneAndUpdate(
    { employee_id, month: parseInt(month), year: parseInt(year) },
    {
      $setOnInsert: { company_id: req.user.company_id },
      basic_salary: parseFloat(basic_salary),
      deductions:   parseFloat(req.body.deductions || 0),
      net_salary,
      payment_mode: req.body.payment_mode || 'Bank',
      payment_date: req.body.payment_date || null,
    },
    { upsert: true, new: true }
  ).lean();
  sendSuccess(res, sal, 'Salary record created.', 201);
}

/** PATCH /api/salary/:id/pay */
async function paySalary(req, res) {
  const { payment_date, payment_mode } = req.body;

  const sal = await SalaryRecord.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    {
      status:       'Paid',
      payment_date: payment_date ? new Date(payment_date) : new Date(),
      payment_mode: payment_mode || 'Bank',
    },
    { new: true }
  ).lean();
  if (!sal) return sendError(res, 'Salary record not found.', 404);
  sendSuccess(res, sal, 'Salary marked as paid.');
}

module.exports = { listSalaryRecords, createSalaryRecord, paySalary };
