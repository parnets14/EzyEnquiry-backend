const mongoose = require('mongoose');

const grnItemSchema = new mongoose.Schema({
  product_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  product_name:  { type: String, default: '' },
  ordered_qty:   { type: Number, default: 0 },
  received_qty:  { type: Number, default: 0 },
  short_qty:     { type: Number, default: 0 },
  damaged_qty:   { type: Number, default: 0 },
  unit:          { type: String, default: 'Box' },
  batch_no:      { type: String, default: '' },
  lot_no:        { type: String, default: '' },
  shade:         { type: String, default: '' },
  caliber:       { type: String, default: '' },
  grade:         { type: String, default: '' },
  rate:          { type: Number, default: 0 },
  remarks:       { type: String, default: '' },
}, { _id: false });

const grnSchema = new mongoose.Schema({
  company_id:            { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  grn_number:            { type: String, default: '' },
  grn_date:              { type: Date, default: Date.now },
  po_id:                 { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', default: null },
  po_number:             { type: String, default: '' },
  supplier_id:           { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
  supplier_name:         { type: String, default: '' },
  supplier_invoice_no:   { type: String, default: '' },
  supplier_invoice_date: { type: Date, default: null },
  warehouse_id:          { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', default: null },
  warehouse_name:        { type: String, default: '' },
  vehicle_number:        { type: String, default: '' },
  driver_name:           { type: String, default: '' },
  remarks:               { type: String, default: '' },
  status:                { type: String, enum: ['Draft','Pending','Approved','Cancelled'], default: 'Draft' },
  approval_remarks:      { type: String, default: '' },
  approved_by:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  approved_at:           { type: Date, default: null },
  items:                 [grnItemSchema],
  created_by:            { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  created_by_name:       { type: String, default: '' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

grnSchema.index({ company_id: 1, status: 1 });
grnSchema.index({ company_id: 1, grn_number: 1 });
grnSchema.index({ company_id: 1, po_id: 1 });

module.exports = mongoose.model('GRN', grnSchema);
