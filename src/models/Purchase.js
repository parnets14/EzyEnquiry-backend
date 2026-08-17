const mongoose = require('mongoose')
const SupplierModel = require('./Supplier')

const purchaseSchema = new mongoose.Schema({
  purchase_code:   { type: String },
  company_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  supplier_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
  supplier_name:   { type: String, default: '' },
  product_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  product_code:    { type: String, default: '' },
  product_name:    { type: String, default: '' },
  qty:             { type: Number, required: true },
  rate:            { type: Number, required: true },
  amount:          { type: Number, default: 0 },
  gst_percent:     { type: Number, default: 18 },
  gst_amount:      { type: Number, default: 0 },
  total_amount:    { type: Number, default: 0 },
  warehouse_id:    { type: mongoose.Schema.Types.ObjectId, default: null },
  invoice_number:  { type: String, default: '' },
  delivery_number: { type: String, default: '' },
  purchase_date:   { type: Date, default: null },
  branch_id:       { type: mongoose.Schema.Types.ObjectId, default: null },
  branch_name:     { type: String, default: '' },
  status:          {
    type:    String,
    enum:    ['Pending', 'Approved', 'Received', 'Completed', 'Cancelled'],
    default: 'Pending',
  },
  stock_in_done:   { type: Boolean, default: false },   // idempotency guard — prevents duplicate stock-in
  notes:           { type: String, default: '' },
  created_by:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })

purchaseSchema.index({ company_id: 1 })
purchaseSchema.index({ purchase_code: 1 })

const PurchaseModel = mongoose.model('Purchase', purchaseSchema)

async function getNextPurchaseCode() {
  const last = await PurchaseModel.findOne({ purchase_code: /^PUR-/ }).sort({ purchase_code: -1 }).lean()
  if (!last || !last.purchase_code) return 'PUR-0001'
  const num = parseInt(last.purchase_code.split('-')[1], 10)
  return `PUR-${String(num + 1).padStart(4, '0')}`
}

class Purchase {
  static async findAll(company_id, filters = {}) {
    const { search, supplier_id, status, limit = 20, offset = 0 } = filters
    const query = { company_id }
    if (search) {
      query.$or = [
        { supplier_name:  { $regex: search, $options: 'i' } },
        { product_name:   { $regex: search, $options: 'i' } },
        { purchase_code:  { $regex: search, $options: 'i' } },
      ]
    }
    if (supplier_id) query.supplier_id = supplier_id
    if (status)      query.status      = status

    return PurchaseModel.find(query).sort({ created_at: -1 }).skip(offset).limit(limit).lean()
  }

  static async count(company_id, filters = {}) {
    const { search, supplier_id, status } = filters
    const query = { company_id }
    if (search) {
      query.$or = [
        { supplier_name: { $regex: search, $options: 'i' } },
        { product_name:  { $regex: search, $options: 'i' } },
        { purchase_code: { $regex: search, $options: 'i' } },
      ]
    }
    if (supplier_id) query.supplier_id = supplier_id
    if (status)      query.status      = status
    return PurchaseModel.countDocuments(query)
  }

  static async findById(id, company_id) {
    return PurchaseModel.findOne({ _id: id, company_id })
      .populate('supplier_id', 'name')
      .populate('product_id', 'name')
      .lean()
  }

  static async create(data) {
    const {
      company_id, supplier_id, supplier_name,
      product_id, product_code, product_name,
      qty, rate, amount, gst_percent, gst_amount, total_amount,
      warehouse_id, invoice_number, purchase_date, notes, created_by,
      branch_id, branch_name,
    } = data
    const purchase_code = await getNextPurchaseCode()
    const purchase = await PurchaseModel.create({
      purchase_code, company_id,
      supplier_id:  supplier_id  || null,
      supplier_name,
      product_id:   product_id   || null,
      product_code: product_code || '',
      product_name: product_name || '',
      qty, rate, amount, gst_percent, gst_amount, total_amount,
      warehouse_id:    warehouse_id    || null,
      branch_id:       branch_id       || null,
      branch_name:     branch_name     || '',
      invoice_number:  invoice_number  || '',
      delivery_number: data.delivery_number || '',
      purchase_date:   purchase_date   || null,
      status:          'Pending',       // always starts as Pending
      stock_in_done:   false,
      notes:           notes           || '',
      created_by,
    })
    return purchase.toObject()
  }

  static async update(id, company_id, data) {
    const { supplier_name, product_name, qty, rate, gst_percent, invoice_number, delivery_number, purchase_date, notes, branch_id, branch_name, warehouse_id, stock_in_done } = data
    const amount       = parseFloat(qty) * parseFloat(rate)
    const gst_amount   = Math.round(amount * gst_percent / 100)
    const total_amount = amount + gst_amount
    const updateDoc = {
      supplier_name, product_name, qty, rate, amount, gst_percent, gst_amount, total_amount,
      invoice_number, delivery_number: delivery_number || '',
      purchase_date: purchase_date || null,
      notes,
      ...(branch_id  !== undefined && { branch_id:  branch_id  || null }),
      ...(branch_name !== undefined && { branch_name: branch_name || '' }),
      ...(warehouse_id !== undefined && { warehouse_id: warehouse_id || null }),
    }
    if (stock_in_done !== undefined) updateDoc.stock_in_done = stock_in_done
    return PurchaseModel.findOneAndUpdate(
      { _id: id, company_id },
      updateDoc,
      { new: true }
    ).lean()
  }

  /**
   * Update only the status field, with transition validation.
   * Returns { error } on invalid transition, null if not found, or the updated doc.
   */
  static async updateStatus(id, company_id, newStatus) {
    const VALID_TRANSITIONS = {
      'Pending':   ['Approved', 'Cancelled'],
      'Approved':  ['Received', 'Cancelled'],
      'Received':  ['Completed'],
      'Completed': [],          // terminal — no further transitions
      'Cancelled': [],          // terminal — no further transitions
    }

    const purchase = await PurchaseModel.findOne({ _id: id, company_id }).lean()
    if (!purchase) return null

    const allowed = VALID_TRANSITIONS[purchase.status] || []
    if (!allowed.includes(newStatus)) {
      return { error: `Invalid status transition: ${purchase.status} → ${newStatus}. Allowed: ${allowed.join(', ') || 'none'}.` }
    }

    const updateDoc = { status: newStatus }
    // Mark stock_in_done when transitioning to Received (handled by controller)
    return PurchaseModel.findOneAndUpdate(
      { _id: id, company_id },
      { $set: updateDoc },
      { new: true }
    ).lean()
  }

  /** Mark stock_in_done = true atomically (idempotency for stock-in) */
  static async markStockInDone(id, company_id) {
    return PurchaseModel.findOneAndUpdate(
      { _id: id, company_id, stock_in_done: false },   // only if NOT already done
      { $set: { stock_in_done: true } },
      { new: true }
    ).lean()
  }

  static async delete(id, company_id) {
    const result = await PurchaseModel.deleteOne({ _id: id, company_id })
    return result.deletedCount > 0
  }

  static async getNextId() {
    return getNextPurchaseCode()
  }

  // ── Suppliers ──────────────────────────────────────────────
  static async findAllSuppliers(company_id) {
    return SupplierModel.find({ company_id }).sort({ name: 1 }).lean()
  }

  static async findSupplierById(id, company_id) {
    return SupplierModel.findOne({ _id: id, company_id }).lean()
  }

  static async createSupplier(company_id, data) {
    const { name, mobile, email, gst_number, address, city, state, credit_days } = data
    const supplier = await SupplierModel.create({
      company_id, name,
      mobile:      mobile      || '',
      email:       email       || '',
      gst_number:  gst_number  || '',
      address:     address     || '',
      city:        city        || '',
      state:       state       || '',
      credit_days: credit_days || 30,
    })
    return supplier.toObject()
  }

  static async updateSupplier(id, company_id, data) {
    const { name, mobile, email, gst_number, address, city, state, credit_days, is_active } = data
    return SupplierModel.findOneAndUpdate(
      { _id: id, company_id },
      { name, mobile, email, gst_number, address, city, state, credit_days, is_active: is_active !== false },
      { new: true }
    ).lean()
  }

  static async deleteSupplier(id, company_id) {
    const result = await SupplierModel.deleteOne({ _id: id, company_id })
    return result.deletedCount > 0
  }
}

module.exports = Purchase
module.exports.PurchaseModel = PurchaseModel
