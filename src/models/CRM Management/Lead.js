const mongoose = require('mongoose');

// Single source of truth for lead statuses.
// Mirrors the wholesaler's leads screen exactly (retailer parity):
// only these 5 stages are offered in the UI and accepted by the schema.
const LEAD_STATUSES = [
  'New', 'Follow-up', 'Interested', 'Not Interested', 'Converted',
];

const leadSchema = new mongoose.Schema(
  {
    company_id:            { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    name:                  { type: String, required: true },
    mobile:                { type: String, default: '' },
    email:                 { type: String, default: '' },
    source:                { type: String, default: '' },
    notes:                 { type: String, default: '' },
    status:                { type: String, enum: LEAD_STATUSES, default: 'New' },
    assigned_to:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    converted_customer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

leadSchema.index({ company_id: 1, status: 1 });

module.exports = mongoose.model('Lead', leadSchema);
module.exports.LEAD_STATUSES = LEAD_STATUSES;
