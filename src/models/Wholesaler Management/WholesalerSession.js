/**
 * WholesalerSession — tracks active FCM/push tokens per device
 * Used for push notifications to the mobile app.
 */
const mongoose = require('mongoose')

const wholesalerSessionSchema = new mongoose.Schema(
  {
    user_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    company_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    fcm_token:  { type: String, default: '' },
    device_info:{ type: String, default: '' },  // e.g. "Android 14 / Pixel 7"
    is_active:  { type: Boolean, default: true },
    last_seen:  { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
)

wholesalerSessionSchema.index({ user_id: 1 })
wholesalerSessionSchema.index({ company_id: 1 })
wholesalerSessionSchema.index({ fcm_token: 1 })

module.exports = mongoose.model('WholesalerSession', wholesalerSessionSchema)
