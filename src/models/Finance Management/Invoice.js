const mongoose = require('mongoose');

// ── Invoice Line-Item Sub-Schema ─────────────────────────────
const invoiceItemSchema = new mongoose.Schema(
  {
    product_id:        { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    product_name:      { type: String,  default: '' },
    product_code:      { type: String,  default: '' },
    brand_name:        { type: String,  default: '' },
    category_name:     { type: String,  default: '' },
    sub_category_name: { type: String,  default: '' },
    size:              { type: String,  default: '' },
    finish:            { type: String,  default: '' },
    tile_type:         { type: String,  default: '' },
    grade:             { type: String,  default: '' },
    color:             { type: String,  default: '' },
    hsn_code:          { type: String,  default: '' },
    unit:              { type: String,  default: 'Box' },
    gst_percent:       { type: Number,  default: 18 },
    mrp:               { type: Number,  default: 0 },
    retail_price:      { type: Number,  default: 0 },
    dealer_price:      { type: Number,  default: 0 },
    purchase_price:    { type: Number,  default: 0 },
    pcs_per_box:       { type: Number,  default: null },
    sqft_per_box:      { type: Number,  default: null },
    qty:               { type: Number,  default: 1 },
    rate:              { type: Number,  default: 0 },
    disc:              { type: Number,  default: 0 },   // discount %
    taxable_amount:    { type: Number,  default: 0 },   // qty*rate after disc
    gst_amount:        { type: Number,  default: 0 },
    total:             { type: Number,  default: 0 },   // taxable + gst
  },
  { _id: false }
);

// ── Payment History Sub-Schema ───────────────────────────────
const paymentHistorySchema = new mongoose.Schema(
  {
    amount:         { type: Number, required: true },
    payment_date:   { type: Date,   default: Date.now },
    payment_mode:   { type: String, enum: ['Cash', 'Bank Transfer', 'UPI', 'Cheque', 'Card', 'Other'], default: 'Cash' },
    reference_no:   { type: String, default: '' },
    note:           { type: String, default: '' },
    received_by:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

// ── Main Invoice Schema ──────────────────────────────────────
const invoiceSchema = new mongoose.Schema(
  {
    company_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },

    // ── Numbering ──────────────────────────────────────────
    invoice_no:       { type: String, default: '' },     // e.g. INV-0001

    // ── Source References ──────────────────────────────────
    quotation_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Quotation', default: null },
    quotation_no:     { type: String, default: '' },
    sale_id:          { type: mongoose.Schema.Types.ObjectId, ref: 'Sale',      default: null },
    sale_code:        { type: String, default: '' },
    order_id:         { type: mongoose.Schema.Types.ObjectId, ref: 'Order',     default: null },
    order_no:         { type: String, default: '' },

    // ── Customer Info ──────────────────────────────────────
    customer_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Customer',  default: null },
    customer_name:    { type: String, default: '' },
    customer_phone:   { type: String, default: '' },
    customer_email:   { type: String, default: '' },
    billing_address:  { type: String, default: '' },
    shipping_address: { type: String, default: '' },
    gstin:            { type: String, default: '' },    // Customer GSTIN

    // ── Dates ──────────────────────────────────────────────
    invoice_date:     { type: Date, default: Date.now },
    due_date:         { type: Date, default: null },

    // ── Line Items ─────────────────────────────────────────
    items:            { type: [invoiceItemSchema], default: [] },

    // ── Charges & Totals ───────────────────────────────────
    freight_charges:  { type: Number, default: 0 },
    other_charges:    { type: Number, default: 0 },
    subtotal:         { type: Number, default: 0 },     // sum of taxable_amount
    discount_amount:  { type: Number, default: 0 },     // overall discount (₹)
    gst_amount:       { type: Number, default: 0 },     // total GST
    round_off:        { type: Number, default: 0 },
    grand_total:      { type: Number, default: 0 },

    // ── Payment ────────────────────────────────────────────
    paid_amount:      { type: Number, default: 0 },
    balance_due:      { type: Number, default: 0 },
    payment_status:   {
      type: String,
      enum: ['Unpaid', 'Partially Paid', 'Paid', 'Overdue', 'Cancelled'],
      default: 'Unpaid',
    },
    payment_history:  { type: [paymentHistorySchema], default: [] },

    // ── Meta ───────────────────────────────────────────────
    remarks:          { type: String, default: '' },
    terms:            { type: String, default: '' },
    status:           {
      type: String,
      enum: ['draft', 'sent', 'paid', 'partially_paid', 'overdue', 'cancelled'],
      default: 'draft',
    },
    created_by:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

// ── Indexes ─────────────────────────────────────────────────
invoiceSchema.index({ company_id: 1, status: 1 });
invoiceSchema.index({ company_id: 1, invoice_no: 1 });
invoiceSchema.index({ company_id: 1, payment_status: 1 });
invoiceSchema.index({ company_id: 1, customer_id: 1 });

module.exports = mongoose.model('Invoice', invoiceSchema);
