const mongoose = require('mongoose');

const inventorySchema = new mongoose.Schema(
  {
    company_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    product_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    warehouse_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', default: null },
    stock_in:        { type: Number, default: 0 },
    stock_out:       { type: Number, default: 0 },
    current_stock:   { type: Number, default: 0 },
    low_stock_alert: { type: Number, default: 50 },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

inventorySchema.index({ company_id: 1 });
inventorySchema.index({ product_id: 1, warehouse_id: 1 }, { unique: true });

module.exports = mongoose.model('Inventory', inventorySchema);
