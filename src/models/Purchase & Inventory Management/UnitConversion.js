const mongoose = require('mongoose');

const conversionSchema = new mongoose.Schema({
  from_unit: { type: String, default: 'Box' },
  to_unit:   { type: String, default: 'Piece' },
  factor:    { type: Number, default: 1 },
}, { _id: false });

const unitConversionSchema = new mongoose.Schema({
  company_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  product_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  product_name:  { type: String, default: '' },
  base_unit:     { type: String, default: 'Box' },
  conversions:   [conversionSchema],
  remarks:       { type: String, default: '' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

unitConversionSchema.index({ company_id: 1, product_id: 1 });

module.exports = mongoose.model('UnitConversion', unitConversionSchema);
