const mongoose = require('mongoose');

const stockAdjustmentSchema = new mongoose.Schema({
  company_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  adjustment_no:   { type: String, default: '' },
  adjustment_date: { type: Date, default: Date.now },
  product_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  product_name:    { type: String, default: '' },
  warehouse_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', default: null },
  warehouse_name:  { type: String, default: '' },
  adjustment_type: { type: String, enum: ['Increase', 'Decrease'], required: true },
  quantity:        { type: Number, required: true },
  unit:            { type: String, default: 'Box' },
  reason:          { type: String, default: '' },
  batch_no:        { type: String, default: '' },
  lot_no:          { type: String, default: '' },
  remarks:         { type: String, default: '' },
  status:          { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
  approved_by:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  approval_remarks:{ type: String, default: '' },
  approved_at:     { type: Date, default: null },
  created_by:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

stockAdjustmentSchema.index({ company_id: 1, status: 1 });
module.exports = mongoose.model('StockAdjustment', stockAdjustmentSchema);
