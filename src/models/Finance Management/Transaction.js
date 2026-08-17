const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    txn_code:     { type: String, default: '' },
    company_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    type:         { type: String, required: true }, // Received | Paid
    party_name:   { type: String, default: '' },
    reference_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    amount:       { type: Number, required: true },
    mode:         { type: String, default: 'Cash' },
    reference:    { type: String, default: '' },
    notes:        { type: String, default: '' },
    txn_date:     { type: Date, default: Date.now },
    recorded_by:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: 'created_at' } }
);

transactionSchema.index({ company_id: 1, txn_date: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);
