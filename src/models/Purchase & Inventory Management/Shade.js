const mongoose = require('mongoose');

const shadeSchema = new mongoose.Schema({
  company_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  product_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  product_name: { type: String, default: '' },
  shade_code:   { type: String, required: true },
  shade_name:   { type: String, default: '' },
  description:  { type: String, default: '' },
  is_active:    { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

const caliberSchema = new mongoose.Schema({
  company_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  product_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  product_name:  { type: String, default: '' },
  caliber_code:  { type: String, required: true },
  caliber_name:  { type: String, default: '' },
  dimensions:    { type: String, default: '' },
  tolerance:     { type: String, default: '' },
  is_active:     { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

shadeSchema.index({ company_id: 1 });
caliberSchema.index({ company_id: 1 });

const Shade   = mongoose.model('Shade', shadeSchema);
const Caliber = mongoose.model('Caliber', caliberSchema);

module.exports = { Shade, Caliber };
