const mongoose = require('mongoose');

/**
 * EnquiryReplyHistory
 *
 * Every time a reply is sent (by admin CRM, retailer, or wholesaler),
 * a new document is created here — nothing is ever overwritten.
 * The parent Enquiry row still holds the LATEST values for quick display.
 */
const enquiryReplyHistorySchema = new mongoose.Schema(
  {
    enquiry_id:         { type: mongoose.Schema.Types.ObjectId, ref: 'Enquiry', required: true },
    enq_code:           { type: String, default: '' },

    // Who sent this reply
    sender_company_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null },
    sender_user_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'User',    default: null },
    sender_name:        { type: String, default: '' },   // snapshot at send time
    sender_side:        { type: String, enum: ['admin', 'buyer', 'seller'], default: 'admin' },

    // The actual reply values
    offered_price:      { type: Number, default: null },
    available_quantity: { type: Number, default: null },
    unit:               { type: String, default: '' },
    delivery_timeline:  { type: String, default: '' },
    remarks:            { type: String, default: '' },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

enquiryReplyHistorySchema.index({ enquiry_id: 1, created_at: -1 });
enquiryReplyHistorySchema.index({ enq_code: 1,   created_at: -1 });

module.exports = mongoose.model('EnquiryReplyHistory', enquiryReplyHistorySchema);
