const mongoose = require('mongoose');

const supplierSchema = new mongoose.Schema(
  {
    company_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    name:        { type: String, required: true, trim: true },
    mobile:      { type: String, default: '' },
    email:       { type: String, default: '' },
    gst_number:  { type: String, default: '' },
    address:     { type: String, default: '' },
    city:        { type: String, default: '' },
    state:       { type: String, default: '' },
    credit_days: { type: Number, default: 30 },
    outstanding: { type: Number, default: 0 },
    is_active:   { type: Boolean, default: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

supplierSchema.index({ company_id: 1 });

module.exports = mongoose.model('Supplier', supplierSchema);
