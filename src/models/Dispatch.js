const mongoose = require('mongoose')

const dispatchSchema = new mongoose.Schema({
  dispatch_code:          { type: String },
  company_id:             { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  order_id:               { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
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
  dispatch_date:          { type: Date,   default: null },
  expected_delivery_days: { type: Number, default: null },
  expected_delivery:      { type: Date,   default: null },
  delivered_date:         { type: Date,   default: null },
  notes:                  { type: String, default: '' },
  status: {
    type: String,
    enum: ['Dispatched', 'In Transit', 'Delivered', 'Returned'],
    default: 'Dispatched',
  },
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })

dispatchSchema.index({ company_id: 1, status: 1 })

const DispatchModel = mongoose.model('Dispatch', dispatchSchema)

async function getNextDispatchCode() {
  const last = await DispatchModel.findOne({ dispatch_code: /^DIS-/ }).sort({ dispatch_code: -1 }).lean()
  if (!last?.dispatch_code) return 'DIS-0001'
  const num = parseInt(last.dispatch_code.split('-')[1], 10)
  return `DIS-${String(num + 1).padStart(4, '0')}`
}

class Dispatch {
  // ── List all (populates order fields) ──────────────────────
  static async findAll(company_id, filters = {}) {
    const { status, limit = 100, offset = 0 } = filters
    const query = { company_id }
    if (status && status !== 'All') query.status = status
    return DispatchModel.find(query)
      .populate('order_id', 'order_code product_name qty total_amount branch_name enquiry_code invoice_number delivery_address location')
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
      .populate('order_id', 'order_code customer_name product_name qty rate total_amount delivery_address location enquiry_code invoice_number')
      .lean()
  }

  static async findByOrderId(order_id) {
    return DispatchModel.findOne({ order_id }).select('_id dispatch_code status').lean()
  }

  // ── Create ──────────────────────────────────────────────────
  static async create(data) {
    const {
      company_id, order_id,
      enquiry_code, invoice_number, delivery_address,
      customer_name, branch_name,
      vehicle_number, driver_name, driver_mobile,
      transport_name, lr_number,
      dispatch_date, expected_delivery_days, expected_delivery,
      notes, created_by,
    } = data

    // Auto-calc expected delivery date from days if not supplied
    let deliveryDate = expected_delivery || null
    if (!deliveryDate && expected_delivery_days && dispatch_date) {
      const d = new Date(dispatch_date)
      d.setDate(d.getDate() + parseInt(expected_delivery_days))
      deliveryDate = d
    }

    const dispatch_code = await getNextDispatchCode()
    const dispatch = await DispatchModel.create({
      dispatch_code, company_id, order_id,
      enquiry_code:     enquiry_code     || '',
      invoice_number:   invoice_number   || '',
      delivery_address: delivery_address || '',
      customer_name:    customer_name    || '',
      branch_name:      branch_name      || '',
      vehicle_number:   vehicle_number   || '',
      driver_name:      driver_name      || '',
      driver_mobile:    driver_mobile    || '',
      transport_name:   transport_name   || '',
      lr_number:        lr_number        || '',
      dispatch_date:    dispatch_date    || null,
      expected_delivery_days: expected_delivery_days ? parseInt(expected_delivery_days) : null,
      expected_delivery: deliveryDate,
      notes:   notes   || '',
      status:  'Dispatched',
      created_by,
    })
    return dispatch.toObject()
  }

  // ── Update dispatch status (Dispatched → In Transit → Delivered) ─
  static async updateStatus(id, company_id, status) {
    const VALID = ['Dispatched', 'In Transit', 'Delivered', 'Returned']
    if (!VALID.includes(status)) return null
    return DispatchModel.findOneAndUpdate(
      { _id: id, company_id },
      { status },
      { new: true }
    ).lean()
  }

  // ── Mark delivered ──────────────────────────────────────────
  static async markDelivered(id, company_id, delivered_date) {
    return DispatchModel.findOneAndUpdate(
      { _id: id, company_id },
      { status: 'Delivered', delivered_date: delivered_date || new Date() },
      { new: true }
    ).lean()
  }

  // ── Edit dispatch details ───────────────────────────────────
  static async update(id, company_id, data) {
    const {
      vehicle_number, driver_name, driver_mobile,
      transport_name, lr_number,
      branch_name, delivery_address,
      expected_delivery_days, expected_delivery,
      notes,
    } = data

    // Auto-calc date from days if only days supplied
    let deliveryDate = expected_delivery || undefined
    if (expected_delivery_days && !expected_delivery) {
      const existing = await DispatchModel.findOne({ _id: id, company_id }).select('dispatch_date').lean()
      if (existing?.dispatch_date) {
        const d = new Date(existing.dispatch_date)
        d.setDate(d.getDate() + parseInt(expected_delivery_days))
        deliveryDate = d
      }
    }

    const upd = { vehicle_number, driver_name, driver_mobile, transport_name, lr_number, notes: notes || '' }
    if (branch_name      !== undefined) upd.branch_name      = branch_name
    if (delivery_address !== undefined) upd.delivery_address = delivery_address
    if (expected_delivery_days !== undefined)
      upd.expected_delivery_days = expected_delivery_days ? parseInt(expected_delivery_days) : null
    if (deliveryDate !== undefined) upd.expected_delivery = deliveryDate || null

    return DispatchModel.findOneAndUpdate({ _id: id, company_id }, upd, { new: true }).lean()
  }

  static async getNextId() { return getNextDispatchCode() }
}

module.exports = Dispatch
module.exports.DispatchModel = DispatchModel
