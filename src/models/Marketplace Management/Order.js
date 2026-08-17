const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema(
  {
    order_code:       { type: String, default: '' },
    company_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    enquiry_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Enquiry', default: null },
    customer_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    customer_name:    { type: String, required: true },
    customer_mobile:  { type: String, default: '' },
    location:         { type: String, default: '' },
    product_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    product_code:     { type: String, default: '' },
    product_name:     { type: String, default: '' },
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
    status:           { type: String, enum: ['New', 'Accepted', 'Processing', 'Ready', 'Dispatched', 'Delivered', 'Cancelled'], default: 'New' },
    warehouse_status: { type: String, default: '' },
    dispatch_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Dispatch', default: null },
    notes:            { type: String, default: '' },
    created_by:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

orderSchema.index({ company_id: 1, status: 1 });

module.exports = mongoose.model('Order', orderSchema);
