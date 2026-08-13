const mongoose = require('mongoose')

// ── Receivable Schema ─────────────────────────────────────────
const receivableSchema = new mongoose.Schema({
  rcv_code:      { type: String },
  company_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  customer_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
  customer_name: { type: String, default: '' },
  order_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Order',   default: null },
  sale_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Sale',    default: null },
  invoice_amount:{ type: Number, required: true },
  received:      { type: Number, default: 0 },
  outstanding:   { type: Number, required: true },
  due_date:      { type: Date, default: null },
  status:        { type: String, default: 'Pending' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })

receivableSchema.index({ company_id: 1, status: 1 })
const ReceivableModel = mongoose.model('Receivable', receivableSchema)

// ── Payable Schema ────────────────────────────────────────────
const payableSchema = new mongoose.Schema({
  pay_code:      { type: String },
  company_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  supplier_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', default: null },
  supplier_name: { type: String, default: '' },
  purchase_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Purchase', default: null },
  invoice_amount:{ type: Number, required: true },
  paid:          { type: Number, default: 0 },
  outstanding:   { type: Number, required: true },
  due_date:      { type: Date, default: null },
  status:        { type: String, default: 'Pending' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })

payableSchema.index({ company_id: 1, status: 1 })
const PayableModel = mongoose.model('Payable', payableSchema)

// ── Transaction Schema ────────────────────────────────────────
const transactionSchema = new mongoose.Schema({
  txn_code:     { type: String },
  company_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  type:         { type: String, required: true },
  party_name:   { type: String, default: '' },
  reference_id: { type: mongoose.Schema.Types.ObjectId, default: null },
  amount:       { type: Number, required: true },
  mode:         { type: String, default: 'Cash' },
  reference:    { type: String, default: '' },
  notes:        { type: String, default: '' },
  txn_date:     { type: Date, default: Date.now },
  recorded_by:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: { createdAt: 'created_at' } })

transactionSchema.index({ company_id: 1, txn_date: -1 })
const TransactionModel = mongoose.model('Transaction', transactionSchema)

// ── Next Code Helpers ─────────────────────────────────────────
async function getNextCode(Model, field, prefix) {
  const last = await Model.findOne({ [field]: new RegExp(`^${prefix}-`) }).sort({ [field]: -1 }).lean()
  if (!last || !last[field]) return `${prefix}-0001`
  const num = parseInt(last[field].split('-')[1], 10)
  return `${prefix}-${String(num + 1).padStart(4, '0')}`
}

class Payment {
  // ── Receivables ───────────────────────────────────────────
  static async findAllReceivables(company_id, filters = {}) {
    const { status, limit = 20, offset = 0 } = filters
    const query = { company_id }
    if (status && status !== 'All') query.status = status
    return ReceivableModel.find(query).sort({ due_date: 1 }).skip(offset).limit(limit).lean()
  }

  static async countReceivables(company_id, filters = {}) {
    const { status } = filters
    const query = { company_id }
    if (status && status !== 'All') query.status = status
    return ReceivableModel.countDocuments(query)
  }

  static async findReceivableById(id, company_id) {
    return ReceivableModel.findOne({ _id: id, company_id }).lean()
  }

  static async createReceivable(data) {
    const { company_id, customer_id, customer_name, order_id, sale_id, invoice_amount } = data
    const rcv_code = await getNextCode(ReceivableModel, 'rcv_code', 'RCV')
    const rcv = await ReceivableModel.create({
      rcv_code, company_id,
      customer_id: customer_id || null,
      customer_name,
      order_id:    order_id    || null,
      sale_id:     sale_id     || null,
      invoice_amount,
      received:    0,
      outstanding: invoice_amount,
      status:      'Pending',
    })
    return rcv.toObject()
  }

  static async collectReceivable(id, amount) {
    const rcv = await ReceivableModel.findById(id).lean()
    if (!rcv) return null

    const newReceived    = parseFloat(rcv.received) + parseFloat(amount)
    const newOutstanding = Math.max(0, parseFloat(rcv.invoice_amount) - newReceived)
    const newStatus      = newOutstanding <= 0 ? 'Received' : 'Partial'

    return ReceivableModel.findByIdAndUpdate(
      id,
      { received: newReceived, outstanding: newOutstanding, status: newStatus },
      { new: true }
    ).lean()
  }

  static async getReceivableNextId() {
    return getNextCode(ReceivableModel, 'rcv_code', 'RCV')
  }

  // ── Payables ─────────────────────────────────────────────
  static async findAllPayables(company_id, filters = {}) {
    const { status, limit = 20, offset = 0 } = filters
    const query = { company_id }
    if (status && status !== 'All') query.status = status
    return PayableModel.find(query).sort({ due_date: 1 }).skip(offset).limit(limit).lean()
  }

  static async countPayables(company_id, filters = {}) {
    const { status } = filters
    const query = { company_id }
    if (status && status !== 'All') query.status = status
    return PayableModel.countDocuments(query)
  }

  static async findPayableById(id, company_id) {
    return PayableModel.findOne({ _id: id, company_id }).lean()
  }

  static async createPayable(data) {
    const { company_id, supplier_id, supplier_name, purchase_id, invoice_amount } = data
    const pay_code = await getNextCode(PayableModel, 'pay_code', 'PAY')
    const pay = await PayableModel.create({
      pay_code, company_id,
      supplier_id: supplier_id || null,
      supplier_name,
      purchase_id: purchase_id || null,
      invoice_amount,
      paid:        0,
      outstanding: invoice_amount,
      status:      'Pending',
    })
    return pay.toObject()
  }

  static async payPayable(id, amount) {
    const payable = await PayableModel.findById(id).lean()
    if (!payable) return null

    const newPaid        = parseFloat(payable.paid) + parseFloat(amount)
    const newOutstanding = Math.max(0, parseFloat(payable.invoice_amount) - newPaid)
    const newStatus      = newOutstanding <= 0 ? 'Paid' : 'Partial'

    return PayableModel.findByIdAndUpdate(
      id,
      { paid: newPaid, outstanding: newOutstanding, status: newStatus },
      { new: true }
    ).lean()
  }

  static async getPayableNextId() {
    return getNextCode(PayableModel, 'pay_code', 'PAY')
  }

  // ── Transactions ─────────────────────────────────────────
  static async findAllTransactions(company_id, filters = {}) {
    const { type, limit = 30, offset = 0 } = filters
    const query = { company_id }
    if (type && type !== 'All') query.type = type
    return TransactionModel.find(query).sort({ txn_date: -1 }).skip(offset).limit(limit).lean()
  }

  static async countTransactions(company_id, filters = {}) {
    const { type } = filters
    const query = { company_id }
    if (type && type !== 'All') query.type = type
    return TransactionModel.countDocuments(query)
  }

  static async createTransaction(data) {
    const { company_id, type, party_name, reference_id, amount, mode, reference, notes, recorded_by } = data
    const txn_code = await getNextCode(TransactionModel, 'txn_code', 'TXN')
    const txn = await TransactionModel.create({
      txn_code, company_id, type,
      party_name:   party_name   || '',
      reference_id: reference_id || null,
      amount, mode: mode || 'Cash',
      reference: reference || '',
      notes:     notes     || '',
      recorded_by,
      txn_date: new Date(),
    })
    return txn.toObject()
  }

  static async getTransactionNextId() {
    return getNextCode(TransactionModel, 'txn_code', 'TXN')
  }

  // ── Totals for reports ─────────────────────────────────────
  static async getReceivablesTotalOutstanding(company_id) {
    const result = await ReceivableModel.aggregate([
      { $match: { company_id: new mongoose.Types.ObjectId(company_id), status: { $ne: 'Received' } } },
      { $group: { _id: null, total: { $sum: '$outstanding' } } },
    ])
    return result[0]?.total || 0
  }
}

module.exports = Payment
module.exports.ReceivableModel  = ReceivableModel
module.exports.PayableModel     = PayableModel
module.exports.TransactionModel = TransactionModel
