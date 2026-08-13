const mongoose = require('mongoose')

const otpStoreSchema = new mongoose.Schema({
  target:     { type: String, required: true },
  type:       { type: String, default: 'email' },
  otp_hash:   { type: String, required: true },
  purpose:    { type: String, default: 'login' },
  expires_at: { type: Date, required: true },
  used:       { type: Boolean, default: false },
}, { timestamps: { createdAt: 'created_at' } })

otpStoreSchema.index({ target: 1, purpose: 1 })
otpStoreSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 })

module.exports = mongoose.model('OtpStore', otpStoreSchema)
