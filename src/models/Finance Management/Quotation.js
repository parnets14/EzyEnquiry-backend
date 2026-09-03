const mongoose = require('mongoose');

const quotationItemSchema = new mongoose.Schema(
  {
    product_id:        { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    product_name:      { type: String, default: '' },
    product_code:      { type: String, default: '' },
    brand_name:        { type: String, default: '' },
    category_name:     { type: String, default: '' },
    sub_category_name: { type: String, default: '' },
    size:              { type: String, default: '' },
    finish:            { type: String, default: '' },
    tile_type:         { type: String, default: '' },
    grade:             { type: String, default: '' },
    color:             { type: String, default: '' },
    hsn_code:          { type: String, default: '' },
    unit:              { type: String, default: 'Box' },
    gst_percent:       { type: Number, default: 18 },
    mrp:               { type: Number, default: 0 },
    retail_price:      { type: Number, default: 0 },
    dealer_price:      { type: Number, default: 0 },
    purchase_price:    { type: Number, default: 0 },
    pcs_per_box:       { type: Number, default: null },
    sqft_per_box:      { type: Number, default: null },
    qty:               { type: Number, default: 1 },
    rate:              { type: Number, default: 0 },
    disc:              { type: Number, default: 0 },
    total:             { type: Number, default: 0 },
  },
  { _id: false }
);

const quotationSchema = new mongoose.Schema(
  {
    company_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    quotation_no:    { type: String, default: '' },
    // Retailer marketplace origin — set when a retailer sends an enquiry on an
    // Admin product. Lets an accepted quotation create a retailer-visible order.
    buyer_company_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null },
    buyer_user_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    source:           { type: String, default: '' },
    order_id:         { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    enquiry_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Enquiry', default: null },
    enquiry_no:      { type: String, default: '' },
    delivery_no:     { type: String, default: '' },
    customer_name:   { type: String, default: '' },
    customer_phone:  { type: String, default: '' },
    customer_email:  { type: String, default: '' },
    quotation_date:  { type: Date, default: Date.now },
    valid_until:     { type: Date, default: null },
    items:           { type: [quotationItemSchema], default: [] },
    freight_charges: { type: Number, default: 0 },
    other_charges:   { type: Number, default: 0 },
    subtotal:        { type: Number, default: 0 },
    gst_amount:      { type: Number, default: 0 },
    grand_total:     { type: Number, default: 0 },
    remarks:         { type: String, default: '' },
    terms:           { type: String, default: '' },
    status:          { type: String, enum: ['draft', 'sent', 'accepted', 'converted', 'expired', 'cancelled'], default: 'draft' },
    created_by:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    created_by_name: { type: String, default: '' },
    // Who created/sent this (the retailer business + person + contact).
    created_by_company: { type: String, default: '' },
    created_by_person:  { type: String, default: '' },
    created_by_mobile:  { type: String, default: '' },
    created_by_email:   { type: String, default: '' },
    created_by_type:    { type: String, default: '' }, // Admin | Wholesaler | Retailer App | Staff App
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

quotationSchema.index({ company_id: 1, status: 1 });
quotationSchema.index({ company_id: 1, quotation_no: 1 });

module.exports = mongoose.model('Quotation', quotationSchema);
