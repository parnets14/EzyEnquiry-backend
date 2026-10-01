const mongoose = require('mongoose');

const poItemSchema = new mongoose.Schema({
  product_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  product_name:  { type: String, default: '' },
  quantity:      { type: Number, default: 0 },
  received_qty:  { type: Number, default: 0 },
  unit:          { type: String, default: 'Box' },
  rate:          { type: Number, default: 0 },
  discount:      { type: Number, default: 0 },
  gst_percent:   { type: Number, default: 18 },
  amount:        { type: Number, default: 0 },
}, { _id: false });

const purchaseOrderSchema = new mongoose.Schema({
  company_id:             { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  po_number:              { type: String, default: '' },
  date:                   { type: Date, default: Date.now },
  supplier_id:            { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
  supplier_name:          { type: String, default: '' },
  warehouse_id:           { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', default: null },
  warehouse_name:         { type: String, default: '' },
  requisition_id:         { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseRequisition', default: null },
  expected_delivery_date: { type: Date, default: null },
  payment_terms:          { type: String, default: 'Net 30' },
  freight_charges:        { type: Number, default: 0 },
  other_charges:          { type: Number, default: 0 },
  subtotal:               { type: Number, default: 0 },
  gst_total:              { type: Number, default: 0 },
  grand_total:            { type: Number, default: 0 },
  remarks:                { type: String, default: '' },
  status: {
    type: String,
    enum: ['Draft','Pending Approval','Approved','Sent','Partially Received','Fully Received','Cancelled','Closed'],
    default: 'Draft',
  },
  approval_remarks: { type: String, default: '' },
  approved_by:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  approved_at:      { type: Date, default: null },
  items:            [poItemSchema],
  created_by:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  created_by_name:  { type: String, default: '' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

purchaseOrderSchema.index({ company_id: 1, status: 1 });
purchaseOrderSchema.index({ company_id: 1, po_number: 1 });
purchaseOrderSchema.index({ company_id: 1, supplier_id: 1 });

module.exports = mongoose.model('PurchaseOrder', purchaseOrderSchema);
