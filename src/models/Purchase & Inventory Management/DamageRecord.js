const mongoose = require('mongoose');

const damageSchema = new mongoose.Schema({
  company_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  damage_no:     { type: String, default: '' },
  damage_date:   { type: Date, default: Date.now },
  product_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  product_name:  { type: String, default: '' },
  warehouse_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', default: null },
  warehouse_name:{ type: String, default: '' },
  quantity:      { type: Number, required: true },
  unit:          { type: String, default: 'Box' },
  damage_reason: { type: String, default: '' },
  batch_no:      { type: String, default: '' },
  lot_no:        { type: String, default: '' },
  shade:         { type: String, default: '' },
  caliber:       { type: String, default: '' },
  reported_by:   { type: String, default: '' },
  remarks:       { type: String, default: '' },
  status:        { type: String, enum: ['Pending','Approved','Rejected'], default: 'Pending' },
  approved_by:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  approval_remarks: { type: String, default: '' },
  approved_at:   { type: Date, default: null },
  created_by:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

damageSchema.index({ company_id: 1, status: 1 });
damageSchema.index({ company_id: 1, product_id: 1 });

module.exports = mongoose.model('DamageRecord', damageSchema);
