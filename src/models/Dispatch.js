const mongoose = require('mongoose')

const dispatchSchema = new mongoose.Schema({
  dispatch_code:     { type: String },
  company_id:        { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  order_id:          { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  customer_name:     { type: String, default: '' },
  vehicle_number:    { type: String, default: '' },
  driver_name:       { type: String, default: '' },
  driver_mobile:     { type: String, default: '' },
  transport_name:    { type: String, default: '' },
  lr_number:         { type: String, default: '' },
  dispatch_date:     { type: Date, default: null },
  expected_delivery: { type: Date, default: null },
  delivered_date:    { type: Date, default: null },
  notes:             { type: String, default: '' },
  status:            { type: String, enum: ['Dispatched', 'In Transit', 'Delivered', 'Returned'], default: 'Dispatched' },
  created_by:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })

dispatchSchema.index({ company_id: 1, status: 1 })

const DispatchModel = mongoose.model('Dispatch', dispatchSchema)

async function getNextDispatchCode() {
  const last = await DispatchModel.findOne({ dispatch_code: /^DIS-/ }).sort({ dispatch_code: -1 }).lean()
  if (!last || !last.dispatch_code) return 'DIS-0001'
  const num = parseInt(last.dispatch_code.split('-')[1], 10)
  return `DIS-${String(num + 1).padStart(4, '0')}`
}

class Dispatch {
  static async findAll(company_id, filters = {}) {
    const { status, limit = 20, offset = 0 } = filters
    const query = { company_id }
    if (status && status !== 'All') query.status = status
    return DispatchModel.find(query)
      .populate('order_id', 'total_amount product_name qty')
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(limit)
      .lean()
  }

  static async count(company_id, filters = {}) {
    const { status } = filters
    const query = { company_id }
    if (status && status !== 'All') query.status = status
    return DispatchModel.countDocuments(query)
  }

  static async findById(id, company_id) {
    return DispatchModel.findOne({ _id: id, company_id })
      .populate('order_id', 'customer_name product_name qty rate total_amount location')
      .lean()
  }

  static async findByOrderId(order_id) {
    return DispatchModel.findOne({ order_id }).select('_id').lean()
  }

  static async create(data) {
    const {
      company_id, order_id, customer_name,
      vehicle_number, driver_name, driver_mobile,
      transport_name, lr_number, dispatch_date, expected_delivery,
      notes, created_by,
    } = data
    const dispatch_code = await getNextDispatchCode()
    const dispatch = await DispatchModel.create({
      dispatch_code, company_id, order_id,
      customer_name: customer_name || '',
      vehicle_number: vehicle_number || '', driver_name: driver_name || '',
      driver_mobile: driver_mobile || '', transport_name: transport_name || '',
      lr_number: lr_number || '',
      dispatch_date: dispatch_date || null,
      expected_delivery: expected_delivery || null,
      notes: notes || '', status: 'Dispatched', created_by,
    })
    return dispatch.toObject()
  }

  static async markDelivered(id, company_id, delivered_date) {
    return DispatchModel.findOneAndUpdate(
      { _id: id, company_id },
      { status: 'Delivered', delivered_date: delivered_date || new Date() },
      { new: true }
    ).lean()
  }

  static async update(id, company_id, data) {
    const { vehicle_number, driver_name, driver_mobile, transport_name, lr_number, expected_delivery, notes } = data
    return DispatchModel.findOneAndUpdate(
      { _id: id, company_id },
      { vehicle_number, driver_name, driver_mobile, transport_name, lr_number, expected_delivery: expected_delivery || null, notes: notes || '' },
      { new: true }
    ).lean()
  }

  static async getNextId() {
    return getNextDispatchCode()
  }
}

module.exports = Dispatch
module.exports.DispatchModel = DispatchModel
