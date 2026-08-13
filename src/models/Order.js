const mongoose = require('mongoose')

const orderSchema = new mongoose.Schema({
  order_code:      { type: String },
  company_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  enquiry_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Enquiry', default: null },
  customer_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
  customer_name:   { type: String, required: true },
  customer_mobile: { type: String, default: '' },
  location:        { type: String, default: '' },
  product_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  product_code:    { type: String, default: '' },
  product_name:    { type: String, default: '' },
  qty:             { type: Number, required: true },
  rate:            { type: Number, required: true },
  amount:          { type: Number, default: 0 },
  gst_percent:     { type: Number, default: 18 },
  gst_amount:      { type: Number, default: 0 },
  total_amount:    { type: Number, default: 0 },
  purchase_rate:   { type: Number, default: 0 },
  purchase_cost:   { type: Number, default: 0 },
  transport_cost:  { type: Number, default: 0 },
  packing_cost:    { type: Number, default: 0 },
  due_date:        { type: Date, default: null },
  status:          { type: String, enum: ['New', 'Accepted', 'Processing', 'Ready', 'Dispatched', 'Delivered', 'Cancelled'], default: 'New' },
  warehouse_status: { type: String, default: '' },
  dispatch_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Dispatch', default: null },
  notes:           { type: String, default: '' },
  created_by:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })

orderSchema.index({ company_id: 1, status: 1 })

const OrderModel = mongoose.model('Order', orderSchema)

async function getNextOrderCode() {
  const last = await OrderModel.findOne({ order_code: /^ORD-/ }).sort({ order_code: -1 }).lean()
  if (!last || !last.order_code) return 'ORD-0001'
  const num = parseInt(last.order_code.split('-')[1], 10)
  return `ORD-${String(num + 1).padStart(4, '0')}`
}

class Order {
  static async findAll(company_id, filters = {}) {
    const { status, search, limit = 20, offset = 0 } = filters
    const query = { company_id }
    if (status && status !== 'All') query.status = status
    if (search) {
      query.$or = [
        { customer_name: { $regex: search, $options: 'i' } },
        { order_code:    { $regex: search, $options: 'i' } },
        { product_name:  { $regex: search, $options: 'i' } },
      ]
    }
    return OrderModel.find(query).sort({ created_at: -1 }).skip(offset).limit(limit).lean()
  }

  static async count(company_id, filters = {}) {
    const { status, search } = filters
    const query = { company_id }
    if (status && status !== 'All') query.status = status
    if (search) {
      query.$or = [
        { customer_name: { $regex: search, $options: 'i' } },
        { order_code:    { $regex: search, $options: 'i' } },
      ]
    }
    return OrderModel.countDocuments(query)
  }

  static async findById(id, company_id) {
    return OrderModel.findOne({ _id: id, company_id })
      .populate('dispatch_id')
      .lean()
  }

  static async create(data) {
    const {
      company_id, enquiry_id, customer_id, customer_name, customer_mobile,
      location, product_id, product_code, product_name,
      qty, rate, amount, gst_percent, gst_amount, total_amount,
      purchase_rate, purchase_cost, transport_cost, packing_cost,
      due_date, notes, created_by,
    } = data
    const order_code = await getNextOrderCode()
    const order = await OrderModel.create({
      order_code, company_id,
      enquiry_id:  enquiry_id  || null,
      customer_id: customer_id || null,
      customer_name, customer_mobile: customer_mobile || '',
      location: location || '',
      product_id: product_id || null, product_code: product_code || '',
      product_name: product_name || '',
      qty, rate, amount, gst_percent, gst_amount, total_amount,
      purchase_rate, purchase_cost, transport_cost, packing_cost,
      due_date: due_date || null, status: 'New',
      notes: notes || '', created_by,
    })
    return order.toObject()
  }

  static async updateStatus(id, company_id, data) {
    const { status, warehouse_status, notes } = data
    const VALID = ['New', 'Accepted', 'Processing', 'Ready', 'Dispatched', 'Delivered', 'Cancelled']
    if (status && !VALID.includes(status)) return null
    const updates = {}
    if (status)           updates.status           = status
    if (warehouse_status) updates.warehouse_status = warehouse_status
    if (notes)            updates.notes            = notes
    return OrderModel.findOneAndUpdate({ _id: id, company_id }, updates, { new: true }).lean()
  }

  static async update(id, company_id, data) {
    const { customer_name, customer_mobile, qty, rate, gst_percent, transport_cost, packing_cost, due_date, notes } = data
    const amount       = parseFloat(qty) * parseFloat(rate)
    const gst_amount   = Math.round(amount * gst_percent / 100)
    const total_amount = amount + gst_amount
    return OrderModel.findOneAndUpdate(
      { _id: id, company_id },
      { customer_name, customer_mobile, qty, rate, amount, gst_percent, gst_amount, total_amount, transport_cost, packing_cost, due_date: due_date || null, notes: notes || '' },
      { new: true }
    ).lean()
  }

  static async setDispatch(id, dispatch_id) {
    await OrderModel.findByIdAndUpdate(id, { dispatch_id, status: 'Dispatched' })
  }

  static async setDelivered(id) {
    await OrderModel.findByIdAndUpdate(id, { status: 'Delivered' })
  }

  static async delete(id, company_id) {
    const result = await OrderModel.deleteOne({ _id: id, company_id })
    return result.deletedCount > 0
  }

  static async getNextId() {
    return getNextOrderCode()
  }
}

module.exports = Order
module.exports.OrderModel = OrderModel
