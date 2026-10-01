const mongoose = require('mongoose');

const lineItemSchema = new mongoose.Schema({
  product_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  product_name: { type: String, default: '' },
  quantity:     { type: Number, default: 0 },
  unit:         { type: String, default: 'Box' },
  remarks:      { type: String, default: '' },
}, { _id: false });

const purchaseRequisitionSchema = new mongoose.Schema({
  company_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  requisition_no:   { type: String, default: '' },
  date:             { type: Date, default: Date.now },
  supplier_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
  supplier_name:    { type: String, default: '' },
  warehouse_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', default: null },
  warehouse_name:   { type: String, default: '' },
  required_date:    { type: Date, default: null },
  priority:         { type: String, enum: ['Low','Medium','High','Urgent'], default: 'Medium' },
  reason:           { type: String, default: '' },
  remarks:          { type: String, default: '' },
  status:           { type: String, enum: ['Draft','Pending Approval','Approved','Rejected','Converted to PO','Cancelled'], default: 'Draft' },
  approval_remarks: { type: String, default: '' },
  approved_by:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  approved_at:      { type: Date, default: null },
  items:            [lineItemSchema],
  created_by:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  created_by_name:  { type: String, default: '' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

purchaseRequisitionSchema.index({ company_id: 1, status: 1 });
purchaseRequisitionSchema.index({ company_id: 1, requisition_no: 1 });

module.exports = mongoose.model('PurchaseRequisition', purchaseRequisitionSchema);
