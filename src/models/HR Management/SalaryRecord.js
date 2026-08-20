const mongoose = require('mongoose');

const salaryRecordSchema = new mongoose.Schema(
  {
    company_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Company',  required: true },
    employee_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    month:        { type: Number, required: true },  // 1-12
    year:         { type: Number, required: true },

    // ── Earnings ──────────────────────────────────────────
    basic_salary:   { type: Number, default: 0 },
    hra:            { type: Number, default: 0 },   // House Rent Allowance
    travel_allow:   { type: Number, default: 0 },   // Travel Allowance
    special_allow:  { type: Number, default: 0 },   // Special Allowance
    bonus:          { type: Number, default: 0 },
    gross_salary:   { type: Number, default: 0 },   // Sum of all earnings

    // ── Deductions ────────────────────────────────────────
    pf_deduction:     { type: Number, default: 0 }, // Provident Fund (12% of basic)
    pt_deduction:     { type: Number, default: 0 }, // Professional Tax
    absent_deduction: { type: Number, default: 0 }, // Per-day * absent_days
    other_deductions: { type: Number, default: 0 },
    total_deductions: { type: Number, default: 0 },

    // ── Net Pay ───────────────────────────────────────────
    net_salary:   { type: Number, default: 0 },     // gross - deductions

    // ── Attendance summary for this month ─────────────────
    working_days: { type: Number, default: 26 },
    present_days: { type: Number, default: 0 },
    absent_days:  { type: Number, default: 0 },
    leave_days:   { type: Number, default: 0 },
    half_days:    { type: Number, default: 0 },

    // ── Payment details ────────────────────────────────────
    payment_mode:      { type: String, enum: ['Cash', 'Bank', 'UPI', 'Cheque'], default: 'Bank' },
    payment_date:      { type: Date, default: null },
    payment_reference: { type: String, default: '' },
    status:            { type: String, enum: ['Pending', 'Processed', 'Paid'], default: 'Pending' },
    processed_by:      { type: String, default: '' },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

salaryRecordSchema.index({ employee_id: 1, month: 1, year: 1 }, { unique: true });
salaryRecordSchema.index({ company_id: 1, year: 1, month: 1 });
salaryRecordSchema.index({ company_id: 1, status: 1 });

module.exports = mongoose.model('SalaryRecord', salaryRecordSchema);
