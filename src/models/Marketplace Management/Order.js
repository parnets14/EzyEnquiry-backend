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
  'Partially Dispatched',
  'Dispatched', 'In Transit', 'Delivered', 'Cancelled',
];

// One partial packing batch: a slice of the order packed → invoiced → dispatched.
const packageSchema = new mongoose.Schema({
  pack_no:        { type: Number, default: 1 },
  qty:            { type: Number, required: true },
  amount:         { type: Number, default: 0 },
  gst_amount:     { type: Number, default: 0 },
  total:          { type: Number, default: 0 },
  invoice_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
  invoice_number: { type: String, default: '' },
  dispatch_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Dispatch', default: null },
  dispatch_code:  { type: String, default: '' },
  vehicle_number: { type: String, default: '' },
  transport_name: { type: String, default: '' },
  lr_number:      { type: String, default: '' },
  packed_by:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  packed_by_name: { type: String, default: '' },
  packed_at:      { type: Date, default: Date.now },
}, { _id: true });

const orderSchema = new mongoose.Schema(
  {
    order_code:       { type: String, default: '' },
    company_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    buyer_company_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null },
    buyer_user_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    seller_company_id:{ type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null },
    offer_id:         { type: mongoose.Schema.Types.ObjectId, ref: 'EnquiryOffer', default: null },
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
    other_cost:       { type: Number, default: 0 },
    due_date:         { type: Date, default: null },
    order_date:       { type: Date, default: Date.now },
    status:           { type: String, enum: ORDER_STATUSES, default: 'New' },
    warehouse_status: { type: String, default: '' },
    invoice_number:   { type: String, default: '' },
    invoice_date:     { type: Date, default: null },
    dispatch_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Dispatch', default: null },
    delivered_date:   { type: Date, default: null },
    // Partial fulfillment tracking
    packed_qty:       { type: Number, default: 0 },
    dispatched_qty:   { type: Number, default: 0 },
    packages:         [packageSchema],
    status_history:   [historySchema],
    notes:            { type: String, default: '' },
    created_by:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    created_by_name:  { type: String, default: '' },
    // Who created/sent this (the retailer business + person + contact).
    created_by_company: { type: String, default: '' },
    created_by_person:  { type: String, default: '' },
    created_by_mobile:  { type: String, default: '' },
    created_by_email:   { type: String, default: '' },
    created_by_type:    { type: String, default: '' }, // Admin | Wholesaler | Retailer App | Staff App
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

orderSchema.index({ company_id: 1, status: 1 });
orderSchema.index({ enquiry_id: 1 });
orderSchema.index({ buyer_company_id: 1, buyer_user_id: 1, created_at: -1 });
orderSchema.index({ seller_company_id: 1, status: 1 });
orderSchema.index(
  { offer_id: 1 },
  { unique: true, partialFilterExpression: { offer_id: { $type: 'objectId' } } }
);

module.exports = mongoose.model('Order', orderSchema);
