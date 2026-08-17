const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    company_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    user_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'User',    default: null },
    type:         { type: String, required: true },
    title:        { type: String, required: true },
    message:      { type: String, required: true },
    reference_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    is_read:      { type: Boolean, default: false },
  },
  { timestamps: { createdAt: 'created_at' } }
);

notificationSchema.index({ company_id: 1, is_read: 1 });
notificationSchema.index({ user_id: 1, is_read: 1 });

module.exports = mongoose.model('Notification', notificationSchema);
