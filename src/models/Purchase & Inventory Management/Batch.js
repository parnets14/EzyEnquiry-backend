const mongoose = require('mongoose');

const batchSchema = new mongoose.Schema({
  company_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  batch_no:      { type: String, required: true },
  lot_no:        { type: String, default: '' },
  product_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  product_name:  { type: String, default: '' },
  warehouse_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', default: null },
  warehouse_name:{ type: String, default: '' },
  quantity:      { type: Number, default: 0 },
  unit:          { type: String, default: 'Box' },
  date:          { type: Date, default: Date.now },
  expiry_date:   { type: Date, default: null },
  supplier_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
  grn_ref:       { type: String, default: '' },
  purchase_rate: { type: Number, default: 0 },
  remarks:       { type: String, default: '' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

batchSchema.index({ company_id: 1, batch_no: 1 });
batchSchema.index({ company_id: 1, product_id: 1 });

module.exports = mongoose.model('Batch', batchSchema);
