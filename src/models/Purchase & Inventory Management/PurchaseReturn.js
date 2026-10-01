const mongoose = require('mongoose');

const returnItemSchema = new mongoose.Schema({
  product_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  product_name: { type: String, default: '' },
  return_qty:   { type: Number, default: 0 },
  unit:         { type: String, default: 'Box' },
  rate:         { type: Number, default: 0 },
  amount:       { type: Number, default: 0 },
  reason:       { type: String, default: '' },
  batch_no:     { type: String, default: '' },
  lot_no:       { type: String, default: '' },
}, { _id: false });

const purchaseReturnSchema = new mongoose.Schema({
  company_id:          { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  return_no:           { type: String, default: '' },
  return_date:         { type: Date, default: Date.now },
  po_id:               { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', default: null },
  po_number:           { type: String, default: '' },
  grn_id:              { type: mongoose.Schema.Types.ObjectId, ref: 'GRN', default: null },
  grn_number:          { type: String, default: '' },
  supplier_id:         { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
  supplier_name:       { type: String, default: '' },
  warehouse_id:        { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', default: null },
  warehouse_name:      { type: String, default: '' },
  reason:              { type: String, default: '' },
  remarks:             { type: String, default: '' },
  total_return_value:  { type: Number, default: 0 },
  status:              { type: String, enum: ['Draft','Pending','Approved','Completed','Cancelled'], default: 'Draft' },
  approval_remarks:    { type: String, default: '' },
  approved_by:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  approved_at:         { type: Date, default: null },
  items:               [returnItemSchema],
  created_by:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

purchaseReturnSchema.index({ company_id: 1, status: 1 });
purchaseReturnSchema.index({ company_id: 1, supplier_id: 1 });

module.exports = mongoose.model('PurchaseReturn', purchaseReturnSchema);
