const mongoose = require('mongoose');

const departmentSchema = new mongoose.Schema(
  {
    company_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    dept_code:   { type: String, default: '' },
    name:        { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    is_active:   { type: Boolean, default: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

departmentSchema.index({ company_id: 1 });
departmentSchema.index({ company_id: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Department', departmentSchema);
