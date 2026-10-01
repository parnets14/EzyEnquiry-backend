const mongoose = require('mongoose');

const qcItemSchema = new mongoose.Schema({
  product_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  product_name:   { type: String, default: '' },
  received_qty:   { type: Number, default: 0 },
  first_quality:  { type: Number, default: 0 },
  second_quality: { type: Number, default: 0 },
  damaged:        { type: Number, default: 0 },
  rejected:       { type: Number, default: 0 },
  unit:           { type: String, default: 'Box' },
  remarks:        { type: String, default: '' },
}, { _id: false });

const qualityInspectionSchema = new mongoose.Schema({
  company_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  qc_number:        { type: String, default: '' },
  grn_id:           { type: mongoose.Schema.Types.ObjectId, ref: 'GRN', default: null },
  grn_number:       { type: String, default: '' },
  supplier_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
  supplier_name:    { type: String, default: '' },
  inspection_date:  { type: Date, default: Date.now },
  inspected_by:     { type: String, default: '' },
  remarks:          { type: String, default: '' },
  status:           { type: String, enum: ['Pending','Approved','Rejected'], default: 'Pending' },
  approval_remarks: { type: String, default: '' },
  approved_by:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  approved_at:      { type: Date, default: null },
  items:            [qcItemSchema],
  created_by:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

qualityInspectionSchema.index({ company_id: 1, status: 1 });
qualityInspectionSchema.index({ company_id: 1, grn_id: 1 });

module.exports = mongoose.model('QualityInspection', qualityInspectionSchema);
