const mongoose = require('mongoose');

const openingItemSchema = new mongoose.Schema({
  product_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  product_name: { type: String, default: '' },
  quantity:     { type: Number, default: 0 },
  unit:         { type: String, default: 'Box' },
  cost:         { type: Number, default: 0 },
  batch_no:     { type: String, default: '' },
  lot_no:       { type: String, default: '' },
  shade:        { type: String, default: '' },
  caliber:      { type: String, default: '' },
  grade:        { type: String, default: '' },
}, { _id: false });

const openingStockSchema = new mongoose.Schema({
  company_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  entry_no:      { type: String, default: '' },
  date:          { type: Date, default: Date.now },
  warehouse_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', default: null },
  warehouse_name:{ type: String, default: '' },
  remarks:       { type: String, default: '' },
  items:         [openingItemSchema],
  created_by:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

openingStockSchema.index({ company_id: 1 });

module.exports = mongoose.model('OpeningStock', openingStockSchema);
