/**
 * StaffSession — tracks active Staff App logins / push tokens per device.
 * Links an HR Employee (and its login-capable User) to the Staff mobile app.
 */
const mongoose = require('mongoose')

const staffSessionSchema = new mongoose.Schema(
  {
    employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    user_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'User',     required: true },
    company_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Company',  required: true },
    fcm_token:   { type: String, default: '' },
    device_info: { type: String, default: '' }, // e.g. "Android 14 / Pixel 7"
    is_active:   { type: Boolean, default: true },
    last_seen:   { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
)

staffSessionSchema.index({ employee_id: 1 })
staffSessionSchema.index({ user_id: 1 })
staffSessionSchema.index({ company_id: 1 })

module.exports = mongoose.model('StaffSession', staffSessionSchema)
