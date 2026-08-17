const mongoose = require('mongoose');

const receivableSchema = new mongoose.Schema(
  {
    rcv_code:       { type: String, default: '' },
    company_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Company',  required: true },
    customer_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    customer_name:  { type: String, default: '' },
    order_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Order',    default: null },
    sale_id:        { type: mongoose.Schema.Types.ObjectId, ref: 'Sale',     default: null },
    invoice_amount: { type: Number, required: true },
    received:       { type: Number, default: 0 },
    outstanding:    { type: Number, required: true },
    due_date:       { type: Date, default: null },
    status:         { type: String, default: 'Pending' },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

receivableSchema.index({ company_id: 1, status: 1 });

module.exports = mongoose.model('Receivable', receivableSchema);
