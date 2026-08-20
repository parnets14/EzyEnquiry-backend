const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema(
  {
    company_id:            { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    name:                  { type: String, required: true },
    mobile:                { type: String, default: '' },
    email:                 { type: String, default: '' },
    source:                { type: String, default: '' },
    notes:                 { type: String, default: '' },
    status:                { type: String, enum: ['New', 'Follow-up', 'Interested', 'Not Interested', 'Converted'], default: 'New' },
    assigned_to:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    converted_customer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

leadSchema.index({ company_id: 1, status: 1 });

module.exports = mongoose.model('Lead', leadSchema);
