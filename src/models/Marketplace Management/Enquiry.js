const mongoose = require('mongoose');

const enquirySchema = new mongoose.Schema(
  {
    enq_code:          { type: String, default: '' },
    company_id:        { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    buyer_company_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null },
    buyer_user_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    seller_company_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null },
    retailer_name:     { type: String, required: true },
    retailer_mobile:   { type: String, default: '' },
    retailer_email:    { type: String, default: '' },
    location:          { type: String, default: '' },
    product_id:        { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    product_code:      { type: String, default: '' },
    product_name:      { type: String, default: '' },
    qty:               { type: Number, required: true },
    unit:              { type: String, default: 'Sq Ft' },
    offered_price:     { type: Number, default: null },
    status:            { type: String, enum: ['New', 'Viewed', 'Replied', 'Negotiation', 'Confirmed', 'Cancelled'], default: 'New' },
    distributor_reply: { type: String, default: '' },
    negotiation_note:  { type: String, default: '' },
    remarks:           { type: String, default: '' },
    order_id:          { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    created_by:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

enquirySchema.index({ company_id: 1, status: 1 });
enquirySchema.index({ buyer_company_id: 1, buyer_user_id: 1, created_at: -1 });
enquirySchema.index({ seller_company_id: 1, status: 1 });

module.exports = mongoose.model('Enquiry', enquirySchema);
