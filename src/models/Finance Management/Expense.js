const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema(
  {
    company_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    category:     { type: String, required: true },
    amount:       { type: Number, required: true },
    description:  { type: String, default: '' },
    expense_date: { type: Date, default: null },
    payment_mode: { type: String, default: 'Cash' },
    reference:    { type: String, default: '' },
    added_by:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

expenseSchema.index({ company_id: 1, expense_date: 1 });

module.exports = mongoose.model('Expense', expenseSchema);
