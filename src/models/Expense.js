const mongoose = require('mongoose')

const expenseSchema = new mongoose.Schema({
  company_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  category:      { type: String, required: true },
  amount:        { type: Number, required: true },
  description:   { type: String, default: '' },
  expense_date:  { type: Date, default: null },
  payment_mode:  { type: String, default: 'Cash' },
  reference:     { type: String, default: '' },
  added_by:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })

expenseSchema.index({ company_id: 1, expense_date: 1 })

const ExpenseModel = mongoose.model('Expense', expenseSchema)

class Expense {
  static async findAll(company_id, filters = {}) {
    const { category, from_date, to_date, limit = 20, offset = 0 } = filters
    const query = { company_id }
    if (category)  query.category     = { $regex: category, $options: 'i' }
    if (from_date) query.expense_date = { ...query.expense_date, $gte: new Date(from_date) }
    if (to_date)   query.expense_date = { ...query.expense_date, $lte: new Date(to_date) }
    return ExpenseModel.find(query)
      .populate('added_by', 'name')
      .sort({ expense_date: -1 })
      .skip(offset)
      .limit(limit)
      .lean()
  }

  static async count(company_id, filters = {}) {
    const { category, from_date, to_date } = filters
    const query = { company_id }
    if (category)  query.category     = { $regex: category, $options: 'i' }
    if (from_date) query.expense_date = { ...query.expense_date, $gte: new Date(from_date) }
    if (to_date)   query.expense_date = { ...query.expense_date, $lte: new Date(to_date) }
    return ExpenseModel.countDocuments(query)
  }

  static async getTotal(company_id, filters = {}) {
    const { category, from_date, to_date } = filters
    const query = { company_id }
    if (category)  query.category     = { $regex: category, $options: 'i' }
    if (from_date) query.expense_date = { ...query.expense_date, $gte: new Date(from_date) }
    if (to_date)   query.expense_date = { ...query.expense_date, $lte: new Date(to_date) }
    const result = await ExpenseModel.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ])
    return result[0]?.total || 0
  }

  static async create(company_id, data) {
    const { category, amount, description, expense_date, payment_mode, reference, added_by } = data
    const expense = await ExpenseModel.create({
      company_id, category, amount,
      description:  description  || '',
      expense_date: expense_date || null,
      payment_mode: payment_mode || 'Cash',
      reference:    reference    || '',
      added_by,
    })
    return expense.toObject()
  }

  static async update(id, company_id, data) {
    const { category, amount, description, expense_date, payment_mode, reference } = data
    return ExpenseModel.findOneAndUpdate(
      { _id: id, company_id },
      { category, amount, description, expense_date: expense_date || null, payment_mode, reference },
      { new: true }
    ).lean()
  }

  static async delete(id, company_id) {
    const result = await ExpenseModel.deleteOne({ _id: id, company_id })
    return result.deletedCount > 0
  }

  static async getBreakdown(company_id, from_date, to_date) {
    const query = { company_id }
    if (from_date) query.expense_date = { $gte: new Date(from_date) }
    if (to_date)   query.expense_date = { ...query.expense_date, $lte: new Date(to_date) }
    return ExpenseModel.aggregate([
      { $match: query },
      { $group: { _id: '$category', total: { $sum: '$amount' } } },
      { $project: { category: '$_id', total: 1, _id: 0 } },
      { $sort: { total: -1 } },
    ])
  }
}

module.exports = Expense
module.exports.ExpenseModel = ExpenseModel
