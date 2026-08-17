const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const Expense = require('../../models/Finance Management/Expense');

/** GET /api/expenses */
async function listExpenses(req, res) {
  const { category, from_date, to_date, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = { company_id: req.user.company_id };
  if (category)  query.category     = { $regex: category, $options: 'i' };
  if (from_date) query.expense_date = { ...query.expense_date, $gte: new Date(from_date) };
  if (to_date)   query.expense_date = { ...query.expense_date, $lte: new Date(to_date) };

  const [total, expenses, totalAgg] = await Promise.all([
    Expense.countDocuments(query),
    Expense.find(query).populate('added_by', 'name').sort({ expense_date: -1 }).skip(offset).limit(parseInt(limit)).lean(),
    Expense.aggregate([{ $match: query }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
  ]);

  sendSuccess(res, { expenses, totalAmount: totalAgg[0]?.total || 0, pagination: paginate(total, parseInt(page), parseInt(limit)) });
}

/** POST /api/expenses */
async function createExpense(req, res) {
  const { category, amount } = req.body;
  if (!category || !amount) return sendError(res, 'Category and amount are required.');

  const expense = await Expense.create({
    company_id:   req.user.company_id,
    category,
    amount,
    description:  req.body.description  || '',
    expense_date: req.body.expense_date || null,
    payment_mode: req.body.payment_mode || 'Cash',
    reference:    req.body.reference    || '',
    added_by:     req.user._id,
  });
  sendSuccess(res, expense, 'Expense recorded.', 201);
}

/** PUT /api/expenses/:id */
async function updateExpense(req, res) {
  const { category, amount, description, expense_date, payment_mode, reference } = req.body;
  const update = {};
  if (category     !== undefined) update.category     = category;
  if (amount       !== undefined) update.amount       = amount;
  if (description  !== undefined) update.description  = description;
  if (expense_date !== undefined) update.expense_date = expense_date || null;
  if (payment_mode !== undefined) update.payment_mode = payment_mode;
  if (reference    !== undefined) update.reference    = reference;

  const expense = await Expense.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    update,
    { new: true }
  ).lean();
  if (!expense) return sendError(res, 'Expense not found.', 404);
  sendSuccess(res, expense, 'Expense updated.');
}

/** DELETE /api/expenses/:id */
async function deleteExpense(req, res) {
  const result = await Expense.deleteOne({ _id: req.params.id, company_id: req.user.company_id });
  if (result.deletedCount === 0) return sendError(res, 'Expense not found.', 404);
  sendSuccess(res, null, 'Expense deleted.');
}

module.exports = { listExpenses, createExpense, updateExpense, deleteExpense };
