const mongoose = require('mongoose');

const historySchema = new mongoose.Schema({
  status:          { type: String },
  updated_by:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updated_by_name: { type: String, default: '' },
  updated_by_role: { type: String, default: '' },
  remarks:         { type: String, default: '' },
  timestamp:       { type: Date, default: Date.now },
}, { _id: false });

const ORDER_STATUSES = [
  'New', 'Pending Approval', 'Approved',
  'Picking Started', 'Picking Completed',
  'Sorting Started', 'Sorting Completed',
  'Packing Started', 'Packing Completed',
  'Invoice Generated', 'Ready for Dispatch',
  'Dispatched', 'In Transit', 'Delivered', 'Cancelled',
];

const orderSchema = new mongoose.Schema(
  {
    order_code:       { type: String, default: '' },
    company_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    enquiry_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Enquiry', default: null },
    enquiry_code:     { type: String, default: '' },
    customer_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    branch_id:        { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null },
    branch_name:      { type: String, default: '' },
    customer_name:    { type: String, required: true },
    customer_mobile:  { type: String, default: '' },
    customer_email:   { type: String, default: '' },
    delivery_address: { type: String, default: '' },
    location:         { type: String, default: '' },
    product_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    product_code:     { type: String, default: '' },
    product_name:     { type: String, default: '' },
    unit:             { type: String, default: 'Pcs' },
    qty:              { type: Number, required: true },
    rate:             { type: Number, required: true },
    amount:           { type: Number, default: 0 },
    gst_percent:      { type: Number, default: 18 },
    gst_amount:       { type: Number, default: 0 },
    total_amount:     { type: Number, default: 0 },
    purchase_rate:    { type: Number, default: 0 },
    purchase_cost:    { type: Number, default: 0 },
    transport_cost:   { type: Number, default: 0 },
    packing_cost:     { type: Number, default: 0 },
    due_date:         { type: Date, default: null },
    order_date:       { type: Date, default: Date.now },
    status:           { type: String, enum: ORDER_STATUSES, default: 'New' },
    warehouse_status: { type: String, default: '' },
    invoice_number:   { type: String, default: '' },
    invoice_date:     { type: Date, default: null },
    dispatch_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Dispatch', default: null },
    delivered_date:   { type: Date, default: null },
    status_history:   [historySchema],
    notes:            { type: String, default: '' },
    created_by:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    created_by_name:  { type: String, default: '' },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

orderSchema.index({ company_id: 1, status: 1 });
orderSchema.index({ enquiry_id: 1 });

module.exports = mongoose.model('Order', orderSchema);
