const mongoose = require('mongoose')

// ── Full SOW status list ──────────────────────────────────────
const ORDER_STATUSES = [
  'New', 'Pending Approval', 'Approved',
  'Picking Started', 'Picking Completed',
  'Sorting Started', 'Sorting Completed',
  'Packing Started', 'Packing Completed',
  'Invoice Generated', 'Ready for Dispatch',
  'Dispatched', 'In Transit', 'Delivered', 'Cancelled',
]

// Valid next statuses per current status
const VALID_TRANSITIONS = {
  'New':               ['Pending Approval', 'Cancelled'],
  'Pending Approval':  ['Approved', 'Cancelled'],
  'Approved':          ['Picking Started', 'Cancelled'],
  'Picking Started':   ['Picking Completed', 'Cancelled'],
  'Picking Completed': ['Sorting Started'],
  'Sorting Started':   ['Sorting Completed'],
  'Sorting Completed': ['Packing Started'],
  'Packing Started':   ['Packing Completed'],
  'Packing Completed': ['Invoice Generated'],
  'Invoice Generated': ['Ready for Dispatch'],
  'Ready for Dispatch':['Dispatched'],
  'Dispatched':        ['In Transit'],
  'In Transit':        ['Delivered'],
  'Delivered':         [],
  'Cancelled':         [],
}

// Status history entry schema
const historySchema = new mongoose.Schema({
  status:          { type: String },
  updated_by:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updated_by_name: { type: String, default: '' },
  updated_by_role: { type: String, default: '' },
  remarks:         { type: String, default: '' },
  timestamp:       { type: Date, default: Date.now },
}, { _id: false })

const orderSchema = new mongoose.Schema({
  order_code:       { type: String, index: { unique: true, sparse: true } },
  company_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  enquiry_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Enquiry', default: null },
  enquiry_code:     { type: String, default: '' },
  customer_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
  branch_id:        { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null },
  branch_name:      { type: String, default: '' },

  // Customer
  customer_name:    { type: String, required: true },
  customer_mobile:  { type: String, default: '' },
  customer_email:   { type: String, default: '' },
  delivery_address: { type: String, default: '' },
  location:         { type: String, default: '' },

  // Product
  product_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  product_code:     { type: String, default: '' },
  product_name:     { type: String, default: '' },
  unit:             { type: String, default: 'Pcs' },

  // Pricing
  qty:              { type: Number, required: true },
  rate:             { type: Number, required: true },
  amount:           { type: Number, default: 0 },
  gst_percent:      { type: Number, default: 18 },
  gst_amount:       { type: Number, default: 0 },
  total_amount:     { type: Number, default: 0 },
  purchase_rate:    { type: Number, default: 0 },
  purchase_cost:    { type: Number, default: 0 },
  transport_cost:   { type: Number, default: 0 },
  packing_cost:     { type: Number, default: 0 },

  due_date:         { type: Date, default: null },
  order_date:       { type: Date, default: Date.now },

  // Status
  status:           { type: String, enum: ORDER_STATUSES, default: 'New' },
  warehouse_status: { type: String, default: '' },    // legacy compat

  // Invoice
  invoice_number:   { type: String, default: '' },
  invoice_date:     { type: Date, default: null },

  // Dispatch
  dispatch_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Dispatch', default: null },

  // Delivery
  delivered_date:   { type: Date, default: null },

  // Status history
  status_history:   [historySchema],

  notes:            { type: String, default: '' },
  created_by:       { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  created_by_name:  { type: String, default: '' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })

orderSchema.index({ company_id: 1, status: 1 })
orderSchema.index({ enquiry_id: 1 })

const OrderModel = mongoose.model('Order', orderSchema)

// ── Order code: ORD-YYYY-NNNNNN ──────────────────────────────
async function getNextOrderCode() {
  const year   = new Date().getFullYear()
  const prefix = `ORD-${year}-`
  const last   = await OrderModel
    .findOne({ order_code: { $regex: `^${prefix}` } })
    .sort({ order_code: -1 })
    .lean()
  if (!last?.order_code) return `${prefix}000001`
  const parts = last.order_code.split('-')
  const num   = parseInt(parts[parts.length - 1], 10) || 0
  return `${prefix}${String(num + 1).padStart(6, '0')}`
}

// ── Invoice number: INV-YYYY-NNNNNN ──────────────────────────
async function getNextInvoiceNumber(company_id) {
  const year   = new Date().getFullYear()
  const prefix = `INV-${year}-`
  const last   = await OrderModel
    .findOne({ company_id, invoice_number: { $regex: `^${prefix}` } })
    .sort({ invoice_number: -1 })
    .lean()
  if (!last?.invoice_number) return `${prefix}000001`
  const parts = last.invoice_number.split('-')
  const num   = parseInt(parts[parts.length - 1], 10) || 0
  return `${prefix}${String(num + 1).padStart(6, '0')}`
}

class Order {
  static get STATUSES()    { return ORDER_STATUSES }
  static get TRANSITIONS() { return VALID_TRANSITIONS }

  static isValidTransition(from, to) {
    return (VALID_TRANSITIONS[from] || []).includes(to)
  }

  // ── Find all ──────────────────────────────────────────────
  static async findAll(company_id, filters = {}) {
    const { status, search, limit = 100, offset = 0 } = filters
    const query = { company_id }
    if (status && status !== 'All') query.status = status
    if (search) {
      query.$or = [
        { customer_name: { $regex: search, $options: 'i' } },
        { order_code:    { $regex: search, $options: 'i' } },
        { product_name:  { $regex: search, $options: 'i' } },
        { enquiry_code:  { $regex: search, $options: 'i' } },
        { branch_name:   { $regex: search, $options: 'i' } },
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
        { enquiry_code:  { $regex: search, $options: 'i' } },
      ]
    }
    return OrderModel.countDocuments(query)
  }

  static async findById(id, company_id) {
    return OrderModel.findOne({ _id: id, company_id })
      .populate('dispatch_id')
      .lean()
  }

  static async findByEnquiryId(enquiry_id) {
    return OrderModel.findOne({ enquiry_id }).select('_id order_code status invoice_number').lean()
  }

  // ── Create ────────────────────────────────────────────────
  static async create(data) {
    const {
      company_id, enquiry_id, enquiry_code,
      customer_id, customer_name, customer_mobile, customer_email,
      branch_id, branch_name, delivery_address, location,
      product_id, product_code, product_name, unit,
      qty, rate, amount, gst_percent, gst_amount, total_amount,
      purchase_rate, purchase_cost, transport_cost, packing_cost,
      due_date, notes, created_by, created_by_name,
    } = data

    const order_code = await getNextOrderCode()

    const order = await OrderModel.create({
      order_code, company_id,
      enquiry_id:      enquiry_id   || null,
      enquiry_code:    enquiry_code || '',
      customer_id:     customer_id  || null,
      branch_id:       branch_id    || null,
      branch_name:     branch_name  || '',
      customer_name,
      customer_mobile:  customer_mobile  || '',
      customer_email:   customer_email   || '',
      delivery_address: delivery_address || location || '',
      location:         location         || '',
      product_id:    product_id    || null,
      product_code:  product_code  || '',
      product_name:  product_name  || '',
      unit:          unit          || 'Pcs',
      qty, rate,
      amount:        amount        || 0,
      gst_percent:   gst_percent   || 18,
      gst_amount:    gst_amount    || 0,
      total_amount:  total_amount  || 0,
      purchase_rate: purchase_rate || 0,
      purchase_cost: purchase_cost || 0,
      transport_cost:transport_cost|| 0,
      packing_cost:  packing_cost  || 0,
      due_date:      due_date      || null,
      status:        'New',
      notes:         notes         || '',
      created_by,
      created_by_name: created_by_name || '',
      order_date:    new Date(),
      status_history: [{
        status:          'New',
        updated_by:      created_by || null,
        updated_by_name: created_by_name || 'System',
        remarks:         'Order created',
        timestamp:       new Date(),
      }],
    })
    return order.toObject()
  }

  // ── Update status with transition validation ──────────────
  static async updateStatus(id, company_id, data) {
    const { status, remarks, updated_by, updated_by_name, updated_by_role } = data

    if (!ORDER_STATUSES.includes(status)) {
      return { error: `Invalid status: ${status}` }
    }

    const order = await OrderModel.findOne({ _id: id, company_id }).lean()
    if (!order) return null

    if (!Order.isValidTransition(order.status, status)) {
      return { error: `Cannot transition from "${order.status}" to "${status}"` }
    }

    const histEntry = {
      status,
      updated_by:      updated_by      || null,
      updated_by_name: updated_by_name || '',
      updated_by_role: updated_by_role || '',
      remarks:         remarks         || '',
      timestamp:       new Date(),
    }

    const updated = await OrderModel.findOneAndUpdate(
      { _id: id, company_id },
      { status, $push: { status_history: histEntry } },
      { new: true }
    ).lean()

    // Auto-generate invoice number when moving to Invoice Generated
    if (status === 'Invoice Generated' && updated) {
      const invoice_number = await getNextInvoiceNumber(company_id)
      return OrderModel.findByIdAndUpdate(
        id,
        { invoice_number, invoice_date: new Date() },
        { new: true }
      ).lean()
    }

    return updated
  }

  // ── Force status (used by dispatch/delivery — no validation) ─
  static async forceStatus(id, status, extra = {}) {
    const histEntry = {
      status,
      updated_by_name: extra.updated_by_name || 'System',
      remarks:         extra.remarks || '',
      timestamp:       new Date(),
    }
    return OrderModel.findByIdAndUpdate(
      id,
      { status, $push: { status_history: histEntry }, ...(extra.fields || {}) },
      { new: true }
    ).lean()
  }

  static async setDispatch(id, dispatch_id) {
    const histEntry = {
      status:          'Dispatched',
      updated_by_name: 'Dispatch',
      remarks:         'Dispatch created',
      timestamp:       new Date(),
    }
    return OrderModel.findByIdAndUpdate(
      id,
      { dispatch_id, status: 'Dispatched', $push: { status_history: histEntry } },
      { new: true }
    ).lean()
  }

  static async setDelivered(id, extra = {}) {
    const histEntry = {
      status:          'Delivered',
      updated_by_name: extra.updated_by_name || 'Delivery',
      remarks:         extra.remarks || 'Delivered',
      timestamp:       new Date(),
    }
    return OrderModel.findByIdAndUpdate(
      id,
      {
        status: 'Delivered',
        delivered_date: extra.delivered_date || new Date(),
        $push: { status_history: histEntry },
      },
      { new: true }
    ).lean()
  }

  // ── General update (non-status fields) ───────────────────
  static async update(id, company_id, data) {
    const {
      customer_name, customer_mobile, customer_email, delivery_address, location,
      qty, rate, gst_percent, transport_cost, packing_cost, due_date, notes,
      branch_id, branch_name, unit,
    } = data
    const amount       = parseFloat(qty) * parseFloat(rate)
    const gst_amount   = Math.round(amount * parseFloat(gst_percent || 18) / 100)
    const total_amount = amount + gst_amount

    return OrderModel.findOneAndUpdate(
      { _id: id, company_id },
      {
        customer_name, customer_mobile: customer_mobile || '',
        customer_email:   customer_email   || '',
        delivery_address: delivery_address || location || '',
        location:         location         || '',
        qty, rate, amount, gst_percent: gst_percent || 18, gst_amount, total_amount,
        transport_cost: transport_cost || 0, packing_cost: packing_cost || 0,
        due_date: due_date || null, notes: notes || '',
        branch_id: branch_id || null, branch_name: branch_name || '',
        unit: unit || 'Pcs',
      },
      { new: true }
    ).lean()
  }

  static async delete(id, company_id) {
    const result = await OrderModel.deleteOne({ _id: id, company_id })
    return result.deletedCount > 0
  }

  static async getNextId() { return getNextOrderCode() }
}

module.exports = Order
module.exports.OrderModel        = OrderModel
module.exports.ORDER_STATUSES    = ORDER_STATUSES
module.exports.VALID_TRANSITIONS = VALID_TRANSITIONS
