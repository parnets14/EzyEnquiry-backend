const mongoose = require('mongoose')

const enquiryMessageSchema = new mongoose.Schema(
  {
    enquiry_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Enquiry', required: true },
    buyer_company_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    buyer_user_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    seller_company_id:{ type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    sender_user_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sender_side:      { type: String, enum: ['buyer', 'seller'], required: true },
    message:          { type: String, required: true, trim: true, maxlength: 2000 },
    client_message_id:{ type: String, default: '', trim: true, maxlength: 100 },
  },
  { timestamps: { createdAt: 'created_at' } }
)

enquiryMessageSchema.index({ enquiry_id: 1, created_at: 1 })
enquiryMessageSchema.index(
  { sender_user_id: 1, client_message_id: 1 },
  { unique: true, partialFilterExpression: { client_message_id: { $type: 'string', $gt: '' } } }
)

module.exports = mongoose.model('EnquiryMessage', enquiryMessageSchema)
