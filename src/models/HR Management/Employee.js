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
    salary:      { type: Number, default: 0 },
    pan:         { type: String, default: '' },
    address:     { type: String, default: '' },
    is_active:   { type: Boolean, default: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

employeeSchema.index({ company_id: 1 });

module.exports = mongoose.model('Employee', employeeSchema);
