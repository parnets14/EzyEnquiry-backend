const mongoose = require('mongoose');

const stockMovementSchema = new mongoose.Schema(
  {
    company_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    movement_code:  { type: String, default: '' },
    product_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    product_name:   { type: String, default: '' },
    product_code:   { type: String, default: '' },
    warehouse_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', default: null },
    warehouse_name: { type: String, default: '' },
    movement_type: {
      type: String,
      enum: ['Stock In', 'Stock Out', 'Transfer In', 'Transfer Out', 'Adjustment', 'Reversal'],
      required: true,
    },
    quantity:       { type: Number, required: true },
    previous_stock: { type: Number, default: 0 },
    new_stock:      { type: Number, default: 0 },
    unit:           { type: String, default: '' },
    reference_type: { type: String, default: '' }, // Purchase | Sale | Transfer | Manual
    reference_id:   { type: String, default: '' },
    supplier_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
    supplier_name:  { type: String, default: '' },
    invoice_number: { type: String, default: '' },
    notes:          { type: String, default: '' },
    created_by:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    movement_date:  { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

stockMovementSchema.index({ company_id: 1 });
stockMovementSchema.index({ product_id: 1, warehouse_id: 1 });
stockMovementSchema.index({ reference_type: 1, reference_id: 1 });

module.exports = mongoose.model('StockMovement', stockMovementSchema);
