const mongoose = require('mongoose')

const enquiryOfferSchema = new mongoose.Schema(
  {
    enquiry_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Enquiry', required: true },
    buyer_company_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    buyer_user_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    seller_company_id:{ type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    seller_user_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Nullable: an offer is normally raised against a catalogue product, but a
    // FREE-TEXT enquiry (the retailer typed the product details instead of
    // picking one) has no product_id, and its recipients must still be able to
    // quote. `required: true` here made those enquiries unanswerable.
    product_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    qty:              { type: Number, required: true, min: 0.001 },
    unit:             { type: String, default: 'Pcs' },
    unit_price:       { type: Number, required: true, min: 0 },
    gst_percent:      { type: Number, required: true, min: 0, max: 100 },
    amount:           { type: Number, required: true, min: 0 },
    gst_amount:       { type: Number, required: true, min: 0 },
    transport_charge: { type: Number, default: 0, min: 0 },
    packing_charge:   { type: Number, default: 0, min: 0 },
    other_charge:     { type: Number, default: 0, min: 0 },
    total_amount:     { type: Number, required: true, min: 0 },
    available_quantity: { type: Number, default: null },   // stock the seller can supply
    delivery_timeline:  { type: String, default: '' },      // e.g. "3-5 days"
    notes:            { type: String, default: '', maxlength: 2000 },
    status:           { type: String, enum: ['Pending', 'Accepted', 'Rejected', 'Withdrawn'], default: 'Pending' },
    responded_at:     { type: Date, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
)

enquiryOfferSchema.index({ enquiry_id: 1, seller_company_id: 1, created_at: -1 })
enquiryOfferSchema.index(
  { enquiry_id: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'Accepted' } }
)

module.exports = mongoose.model('EnquiryOffer', enquiryOfferSchema)
