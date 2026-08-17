const mongoose = require('mongoose');

const warehouseSchema = new mongoose.Schema(
  {
    company_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    warehouse_code: { type: String, default: '' },
    name:           { type: String, required: true, trim: true },
    warehouse_type: { type: String, default: '' }, // e.g. Main, Branch, Depot, Transit
    location:       { type: String, default: '' },
    address:        { type: String, default: '' },
    city:           { type: String, default: '' },
    state:          { type: String, default: '' },
    pincode:        { type: String, default: '' },
    contact_person: { type: String, default: '' },
    mobile:         { type: String, default: '' },
    email:          { type: String, default: '' },
    manager:        { type: String, default: '' },
    branch_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null },
    capacity:       { type: Number, default: 0 },
    unit:           { type: String, default: 'Sq Ft' },
    is_active:      { type: Boolean, default: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

warehouseSchema.index({ company_id: 1 });

module.exports = mongoose.model('Warehouse', warehouseSchema);
