const mongoose = require('mongoose')

const companySchema = new mongoose.Schema(
  {
    company_code:      { type: String, unique: true },
    name:              { type: String, required: true, trim: true },
    owner_name:        { type: String, default: '' },
    biz_type:          { type: String, default: 'Wholesaler' },
    mobile:            { type: String, default: '' },
    email:             { type: String, lowercase: true, trim: true, default: '' },
    gst_number:        { type: String, default: '' },
    pan_number:        { type: String, default: '' },
    address:           { type: String, default: '' },
    city:              { type: String, default: '' },
    state:             { type: String, default: '' },
    pin_code:          { type: String, default: '' },
    subscription_plan: { type: String, default: 'Free' },
    status:            { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
    reject_reason:     { type: String, default: '' },
    reviewed_by:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    docs_gst:          { type: Boolean, default: false },
    docs_pan:          { type: Boolean, default: false },
    docs_address:      { type: Boolean, default: false },
    docs_biz:          { type: Boolean, default: false },

    // ── Document file URLs ────────────────────────────────
    doc_gst_url:      { type: String, default: '' },   // GST Certificate file path
    doc_pan_url:      { type: String, default: '' },   // PAN Card file path
    doc_reg_url:      { type: String, default: '' },   // Business Registration
    doc_trade_url:    { type: String, default: '' },   // Trade License
    logo_url:         { type: String, default: '' },   // Company Logo
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
)

companySchema.index({ status: 1 })
companySchema.index({ subscription_plan: 1 })

module.exports = mongoose.model('Company', companySchema)
