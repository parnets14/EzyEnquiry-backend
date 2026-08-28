const mongoose = require('mongoose')

const registrationVerificationSchema = new mongoose.Schema({
  mobile:     { type: String, required: true, index: true },
  expires_at: { type: Date, required: true },
  used_at:    { type: Date, default: null },
}, { timestamps: { createdAt: 'created_at' } })

registrationVerificationSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 })

module.exports = mongoose.model('RegistrationVerification', registrationVerificationSchema)
