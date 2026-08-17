const mongoose = require('mongoose');

const salaryRecordSchema = new mongoose.Schema(
  {
    company_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Company',  required: true },
    employee_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    month:        { type: Number, required: true },
    year:         { type: Number, required: true },
    basic_salary: { type: Number, default: 0 },
    deductions:   { type: Number, default: 0 },
    net_salary:   { type: Number, default: 0 },
    payment_mode: { type: String, default: 'Bank' },
    payment_date: { type: Date, default: null },
    status:       { type: String, default: 'Pending' },
  },
  { timestamps: { createdAt: 'created_at' } }
);

salaryRecordSchema.index({ employee_id: 1, month: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('SalaryRecord', salaryRecordSchema);
