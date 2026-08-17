const mongoose = require('mongoose');

const followupSchema = new mongoose.Schema(
  {
    company_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    lead_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Lead',     default: null },
    customer_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    followup_date: { type: Date, required: true },
    notes:         { type: String, default: '' },
    status:        { type: String, enum: ['Pending', 'Done', 'Missed'], default: 'Pending' },
    assigned_to:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    done_at:       { type: Date, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

followupSchema.index({ company_id: 1, status: 1 });

module.exports = mongoose.model('Followup', followupSchema);
