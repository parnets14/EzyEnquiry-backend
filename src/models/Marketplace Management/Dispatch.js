const mongoose = require('mongoose');

const dispatchSchema = new mongoose.Schema(
  {
    dispatch_code:          { type: String, default: '' },
    company_id:             { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    order_id:               { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    enquiry_code:           { type: String, default: '' },
    invoice_number:         { type: String, default: '' },
    customer_name:          { type: String, default: '' },
    branch_name:            { type: String, default: '' },
    delivery_address:       { type: String, default: '' },
    vehicle_number:         { type: String, default: '' },
    driver_name:            { type: String, default: '' },
    driver_mobile:          { type: String, default: '' },
    transport_name:         { type: String, default: '' },
    lr_number:              { type: String, default: '' },
    dispatch_date:          { type: Date, default: null },
    expected_delivery_days: { type: Number, default: null },
    expected_delivery:      { type: Date, default: null },
    delivered_date:         { type: Date, default: null },
    notes:                  { type: String, default: '' },
    status:                 { type: String, enum: ['Dispatched', 'In Transit', 'Delivered', 'Returned'], default: 'Dispatched' },
    created_by:             { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

dispatchSchema.index({ company_id: 1, status: 1 });

module.exports = mongoose.model('Dispatch', dispatchSchema);
