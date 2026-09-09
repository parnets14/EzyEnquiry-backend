const mongoose = require('mongoose');

const purchaseSchema = new mongoose.Schema(
  {
    purchase_code:   { type: String, default: '' },
    company_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    supplier_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
    supplier_name:   { type: String, default: '' },
    product_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    product_code:    { type: String, default: '' },
    product_name:    { type: String, default: '' },
    qty:             { type: Number, required: true },
    unit:            { type: String, default: '' },
    rate:            { type: Number, required: true },
    amount:          { type: Number, default: 0 },
    gst_percent:     { type: Number, default: 18 },
    gst_amount:      { type: Number, default: 0 },
    total_amount:    { type: Number, default: 0 },
    warehouse_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', default: null },
    invoice_number:  { type: String, default: '' },
    delivery_number: { type: String, default: '' },
    purchase_date:   { type: Date, default: null },
    branch_id:       { type: mongoose.Schema.Types.ObjectId, default: null },
    branch_name:     { type: String, default: '' },
    status: {
      type:    String,
      enum:    ['Pending', 'Approved', 'Received', 'Completed', 'Cancelled'],
      default: 'Pending',
    },
    stock_in_done:   { type: Boolean, default: false },
    // Links set when an admin approves a wholesaler purchase-order → Order + Invoice
    order_id:        { type: mongoose.Schema.Types.ObjectId, ref: 'Order',   default: null },
    invoice_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
    notes:           { type: String, default: '' },
    created_by:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

purchaseSchema.index({ company_id: 1 });
purchaseSchema.index({ purchase_code: 1 });

module.exports = mongoose.model('Purchase', purchaseSchema);
