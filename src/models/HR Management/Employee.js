const mongoose = require('mongoose');

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
    salary:      { type: Number, default: 0 },   // base monthly salary
    pan:         { type: String, default: '' },
    address:     { type: String, default: '' },
    is_active:   { type: Boolean, default: true },

    // Custom access name assigned by the wholesaler admin (e.g. "Cashier").
    // Falls back to `designation` for the app's role mapping when empty.
    role_access: { type: String, default: '' },

    // Incentive slabs: pay `incentive_pct` % once the staff's sales in a period
    // reach `sales_amount`. Highest crossed slab applies (threshold model).
    // e.g. [{ sales_amount: 50000, incentive_pct: 1 }, { sales_amount: 100000, incentive_pct: 2 }]
    incentive_slabs: {
      type: [
        {
          _id:           false,
          sales_amount:  { type: Number, required: true },
          incentive_pct: { type: Number, required: true },
        },
      ],
      default: [],
    },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

employeeSchema.index({ company_id: 1 });

module.exports = mongoose.model('Employee', employeeSchema);
