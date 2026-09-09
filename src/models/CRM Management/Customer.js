const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema(
  {
    company_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    name:         { type: String, required: true, trim: true },
    mobile:       { type: String, default: '' },
    email:        { type: String, default: '' },
    gst_number:   { type: String, default: '' },
    address:      { type: String, default: '' },
    city:         { type: String, default: '' },
    state:        { type: String, default: '' },
    pincode:      { type: String, default: '' },
    biz_type:     { type: String, default: 'Retailer' },
    credit_limit: { type: Number, default: 0 },
    is_active:    { type: Boolean, default: true },
    // Who created this customer and from which app/source.
    created_by:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    created_by_name: { type: String, default: '' },
    created_by_type: { type: String, enum: ['Admin', 'Retailer App', 'Staff App'], default: 'Admin' },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

customerSchema.index({ company_id: 1 });
customerSchema.index({ mobile: 1 });

module.exports = mongoose.model('Customer', customerSchema);
