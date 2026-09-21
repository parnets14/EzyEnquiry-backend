const mongoose = require('mongoose');

// ── Staff App module keys the access array may contain ────────
// These map directly to the route-group names used by staffDataRoutes.
const STAFF_APP_MODULES = [
  'dashboard',
  'orders',
  'dispatches',
  'invoices',
  'customers',
  'leads',
  'followups',
  'quotations',
  'products',
  'finance',       // invoices + payments rolled up
  'notifications',
  'attendance',    // own attendance view
  'salary',        // own salary/payslip view
];

// ── Salary breakdown sub-schema ───────────────────────────────
const salaryBreakdownSchema = new mongoose.Schema(
  {
    fixed_salary:   { type: Number, default: 0, min: 0 },  // Basic fixed monthly pay

    // Incentive / Bonus
    incentive_type:   { type: String, enum: ['fixed', 'percentage', 'none'], default: 'none' },
    incentive_value:  { type: Number, default: 0, min: 0 }, // Amount if fixed, % if percentage

    // Sales-based percentage (e.g. 2% of invoiced amount)
    sales_percentage: { type: Number, default: 0, min: 0, max: 100 },

    // Discount authority
    discount_access:     { type: Boolean, default: false },
    max_discount_percent: { type: Number, default: 0, min: 0, max: 100 }, // cap on discount they can give

    notes: { type: String, default: '' },
  },
  { _id: false }
);

const employeeSchema = new mongoose.Schema(
  {
    company_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Company',  required: true },
    user_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'User',     default: null },
    emp_code:    { type: String, default: '' },
    name:        { type: String, required: true, trim: true },
    mobile:      { type: String, default: '' },
    email:       { type: String, default: '' },
    department:  { type: String, default: '' },
    designation: { type: String, default: '' },
    branch:      { type: String, default: '' },
    join_date:   { type: Date, default: null },
    salary:      { type: Number, default: 0 },
    pan:         { type: String, default: '' },
    address:     { type: String, default: '' },
    is_active:   { type: Boolean, default: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

employeeSchema.index({ company_id: 1 });
employeeSchema.index({ company_id: 1, mobile: 1 });

module.exports = mongoose.model('Employee', employeeSchema);
module.exports.STAFF_APP_MODULES = STAFF_APP_MODULES;
