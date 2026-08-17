const mongoose = require('mongoose');

const stockTransferSchema = new mongoose.Schema(
  {
    company_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    from_warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    to_warehouse:   { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    product_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity:       { type: Number, required: true },
    notes:          { type: String, default: '' },
    reason:         { type: String, default: '' },
    status:         { type: String, enum: ['Pending', 'In Transit', 'Completed', 'Cancelled'], default: 'Pending' },
    transferred_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approved_by:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

stockTransferSchema.index({ company_id: 1 });

module.exports = mongoose.model('StockTransfer', stockTransferSchema);
