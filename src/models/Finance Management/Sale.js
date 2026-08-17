const mongoose = require('mongoose');

const saleSchema = new mongoose.Schema(
  {
    sale_code:      { type: String, default: '' },
    company_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    order_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Order',    default: null },
    dispatch_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Dispatch', default: null },
    customer_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    customer_name:  { type: String, default: '' },
    product_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Product',  default: null },
    product_code:   { type: String, default: '' },
    product_name:   { type: String, default: '' },
    qty:            { type: Number, default: 0 },
    rate:           { type: Number, default: 0 },
    amount:         { type: Number, default: 0 },
    gst_amount:     { type: Number, default: 0 },
    total_amount:   { type: Number, default: 0 },
    payment_status: { type: String, default: 'Pending' },
    sale_date:      { type: Date, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

saleSchema.index({ company_id: 1 });
saleSchema.index({ sale_date: 1 });

module.exports = mongoose.model('Sale', saleSchema);
