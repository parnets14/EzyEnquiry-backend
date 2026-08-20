const mongoose = require('mongoose');

const designationSchema = new mongoose.Schema(
  {
    company_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Company',    required: true },
    department_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
    desig_code:    { type: String, default: '' },
    name:          { type: String, required: true, trim: true },
    description:   { type: String, default: '' },
    is_active:     { type: Boolean, default: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

designationSchema.index({ company_id: 1 });
designationSchema.index({ company_id: 1, department_id: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Designation', designationSchema);
