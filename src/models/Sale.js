const mongoose = require('mongoose')

const saleSchema = new mongoose.Schema({
  sale_code:      { type: String },
  company_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  order_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Order',    default: null },
  dispatch_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Dispatch', default: null },
  customer_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
  customer_name:  { type: String, default: '' },
  product_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Product',  default: null },
  product_code:   { type: String, default: '' },
  product_name:   { type: String, default: '' },
  qty:            { type: Number, default: 0 },
  rate:           { type: Number, default: 0 },
  amount:         { type: Number, default: 0 },
  gst_amount:     { type: Number, default: 0 },
  total_amount:   { type: Number, default: 0 },
  payment_status: { type: String, default: 'Pending' },
  sale_date:      { type: Date, default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })

saleSchema.index({ company_id: 1 })
saleSchema.index({ sale_date: 1 })

const SaleModel = mongoose.model('Sale', saleSchema)

async function getNextSaleCode() {
  const last = await SaleModel.findOne({ sale_code: /^SAL-/ }).sort({ sale_code: -1 }).lean()
  if (!last || !last.sale_code) return 'SAL-0001'
  const num = parseInt(last.sale_code.split('-')[1], 10)
  return `SAL-${String(num + 1).padStart(4, '0')}`
}

class Sale {
  static async findAll(company_id, filters = {}) {
    const { search, payment_status, limit = 20, offset = 0 } = filters
    const query = { company_id }
    if (search) {
      query.$or = [
        { customer_name: { $regex: search, $options: 'i' } },
        { product_name:  { $regex: search, $options: 'i' } },
        { sale_code:     { $regex: search, $options: 'i' } },
      ]
    }
    if (payment_status && payment_status !== 'All') query.payment_status = payment_status
    return SaleModel.find(query).sort({ sale_date: -1 }).skip(offset).limit(limit).lean()
  }

  static async count(company_id, filters = {}) {
    const { search, payment_status } = filters
    const query = { company_id }
    if (search) {
      query.$or = [
        { customer_name: { $regex: search, $options: 'i' } },
        { product_name:  { $regex: search, $options: 'i' } },
        { sale_code:     { $regex: search, $options: 'i' } },
      ]
    }
    if (payment_status && payment_status !== 'All') query.payment_status = payment_status
    return SaleModel.countDocuments(query)
  }

  static async create(data) {
    const {
      company_id, order_id, dispatch_id, customer_id, customer_name,
      product_id, product_code, product_name,
      qty, rate, amount, gst_amount, total_amount, sale_date,
    } = data
    const sale_code = await getNextSaleCode()
    const sale = await SaleModel.create({
      sale_code, company_id,
      order_id:    order_id    || null,
      dispatch_id: dispatch_id || null,
      customer_id: customer_id || null,
      customer_name,
      product_id:  product_id  || null,
      product_code: product_code || '',
      product_name: product_name || '',
      qty, rate, amount, gst_amount, total_amount,
      payment_status: 'Pending',
      sale_date: sale_date || null,
    })
    return sale.toObject()
  }

  static async updatePaymentStatus(id, status) {
    await SaleModel.findByIdAndUpdate(id, { payment_status: status })
  }

  static async findByOrderId(order_id) {
    return SaleModel.findOne({ order_id }).select('_id sale_code').lean()
  }

  static async getNextId() {
    return getNextSaleCode()
  }

  // ── Totals for reports ─────────────────────────────────────
  static async getTotals(company_id, from_date, to_date) {
    const result = await SaleModel.aggregate([
      {
        $match: {
          company_id: new mongoose.Types.ObjectId(company_id),
          sale_date: { $gte: new Date(from_date), $lte: new Date(to_date) },
        },
      },
      {
        $group: {
          _id:          null,
          total_sales:  { $sum: '$total_amount' },
          base_amount:  { $sum: '$amount' },
          total_gst:    { $sum: '$gst_amount' },
          total_count:  { $sum: 1 },
        },
      },
    ])
    return result[0] || { total_sales: 0, base_amount: 0, total_gst: 0, total_count: 0 }
  }

  static async getMonthlyTrend(company_id) {
    const result = await SaleModel.aggregate([
      {
        $match: {
          company_id: new mongoose.Types.ObjectId(company_id),
          sale_date: { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: {
            year:  { $year:  '$sale_date' },
            month: { $month: '$sale_date' },
          },
          sales:       { $sum: '$total_amount' },
          order_count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': -1, '_id.month': -1 } },
      { $limit: 12 },
      {
        $project: {
          _id: 0,
          month: {
            $dateToString: {
              format: '%b %Y',
              date: { $dateFromParts: { year: '$_id.year', month: '$_id.month', day: 1 } },
            },
          },
          sales:       1,
          order_count: 1,
        },
      },
    ])
    return result.reverse()
  }
}

module.exports = Sale
module.exports.SaleModel = SaleModel
