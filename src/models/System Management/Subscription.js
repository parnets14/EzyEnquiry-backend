const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema(
  {
    company_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    plan:        { type: String, required: true },
    starts_at:   { type: Date, required: true },
    expires_at:  { type: Date, required: true },
    amount_paid: { type: Number, default: 0 },
    payment_ref: { type: String, default: '' },
    status:      { type: String, default: 'Active' },
  },
  { timestamps: { createdAt: 'created_at' } }
);

subscriptionSchema.index({ company_id: 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);
