const mongoose = require('mongoose');

const saleSchema = new mongoose.Schema(
  {
    sale_code:      { type: String, default: '' },
    company_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Company',   required: true },
    order_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Order',     default: null },
    dispatch_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Dispatch',  default: null },
    customer_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Customer',  default: null },
    customer_name:  { type: String, default: '' },
    customer_gstin: { type: String, default: '' },
    billing_address:  { type: String, default: '' },
    delivery_address: { type: String, default: '' },

    // ── Warehouse ──────────────────────────────────────────────────────────
    warehouse_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', default: null },
    warehouse_name: { type: String, default: '' },

    // ── Single-product sale (legacy / simple) ──────────────────────────────
    product_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Product',   default: null },
    product_code:   { type: String, default: '' },
    product_name:   { type: String, default: '' },
    qty:            { type: Number, default: 0 },
    rate:           { type: Number, default: 0 },
    amount:         { type: Number, default: 0 },
    gst_percent:    { type: Number, default: 18 },
    gst_amount:     { type: Number, default: 0 },
    total_amount:   { type: Number, default: 0 },

    // ── Grand total (after discount — canonical field for P&L) ─────────────
    discount:       { type: Number, default: 0 },
    grand_total:    { type: Number, default: 0 },  // total_amount - discount

    // ── COGS (purchase cost × qty — for Gross Profit calculation) ──────────
    cogs:           { type: Number, default: 0 },

    // ── Invoice ────────────────────────────────────────────────────────────
    invoice_number: { type: String, default: '' },
    invoice_date:   { type: Date,   default: null },

    // ── Sales status (mirrors order status lifecycle) ──────────────────────
    sale_status: {
      type:    String,
      enum:    ['Draft', 'Confirmed', 'Reserved', 'Picking', 'Packed',
                'Ready for Dispatch', 'Dispatched', 'Delivered', 'Cancelled'],
      default: 'Confirmed',
    },

    // ── Payment ────────────────────────────────────────────────────────────
    payment_status:  { type: String, default: 'Pending' },   // Pending | Partial | Paid | Overdue
    payment_mode:    { type: String, default: '' },
    paid_amount:     { type: Number, default: 0 },
    outstanding:     { type: Number, default: 0 },           // grand_total - paid_amount

    sale_date:       { type: Date, default: null },
    notes:           { type: String, default: '' },
    created_by:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

saleSchema.index({ company_id: 1 });
saleSchema.index({ sale_date:  1 });
saleSchema.index({ order_id:   1 });
saleSchema.index({ company_id: 1, payment_status: 1 });

module.exports = mongoose.model('Sale', saleSchema);
