const mongoose = require('mongoose');

const rackBinSchema = new mongoose.Schema({
  company_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  warehouse_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true },
  warehouse_name:{ type: String, default: '' },
  rack_name:     { type: String, required: true },
  bin_name:      { type: String, default: '' },
  code:          { type: String, default: '' },
  capacity:      { type: String, default: '' },
  remarks:       { type: String, default: '' },
  is_active:     { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

rackBinSchema.index({ company_id: 1, warehouse_id: 1 });

module.exports = mongoose.model('RackBin', rackBinSchema);
