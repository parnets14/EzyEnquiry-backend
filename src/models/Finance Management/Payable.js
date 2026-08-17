const mongoose = require('mongoose');

const payableSchema = new mongoose.Schema(
  {
    pay_code:       { type: String, default: '' },
    company_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Company',  required: true },
    supplier_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
    supplier_name:  { type: String, default: '' },
    purchase_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Purchase', default: null },
    invoice_amount: { type: Number, required: true },
    paid:           { type: Number, default: 0 },
    outstanding:    { type: Number, required: true },
    due_date:       { type: Date, default: null },
    status:         { type: String, default: 'Pending' },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

payableSchema.index({ company_id: 1, status: 1 });

module.exports = mongoose.model('Payable', payableSchema);
