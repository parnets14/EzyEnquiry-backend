const mongoose = require('mongoose')

const enquirySchema = new mongoose.Schema({
  enq_code:         { type: String },
  company_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  retailer_name:    { type: String, required: true },
  retailer_mobile:  { type: String, default: '' },
  retailer_email:   { type: String, default: '' },
  location:         { type: String, default: '' },
  product_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  product_code:     { type: String, default: '' },
  product_name:     { type: String, default: '' },
  qty:              { type: Number, required: true },
  unit:             { type: String, default: 'Sq Ft' },
  offered_price:    { type: Number, default: null },
  status:           { type: String, enum: ['New', 'Viewed', 'Replied', 'Negotiation', 'Confirmed', 'Cancelled'], default: 'New' },
  distributor_reply:  { type: String, default: '' },
  negotiation_note:   { type: String, default: '' },
  remarks:            { type: String, default: '' },
  order_id:         { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  created_by:       { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })

enquirySchema.index({ company_id: 1, status: 1 })

const EnquiryModel = mongoose.model('Enquiry', enquirySchema)

async function getNextEnqCode() {
  const last = await EnquiryModel.findOne({ enq_code: /^ENQ-/ }).sort({ enq_code: -1 }).lean()
  if (!last || !last.enq_code) return 'ENQ-0001'
  const num = parseInt(last.enq_code.split('-')[1], 10)
  return `ENQ-${String(num + 1).padStart(4, '0')}`
}

class Enquiry {
  static async findAll(company_id, filters = {}) {
    const { status, search, limit = 100, offset = 0, created_by } = filters
    const query = { company_id }
    if (status && status !== 'All') query.status = status
    if (created_by) query.created_by = created_by
    if (search) {
      query.$or = [
        { retailer_name: { $regex: search, $options: 'i' } },
        { product_name:  { $regex: search, $options: 'i' } },
        { enq_code:      { $regex: search, $options: 'i' } },
      ]
    }
    return EnquiryModel.find(query)
      .populate('created_by', 'name role')
      .populate('order_id',   'order_code status invoice_number')
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(limit)
      .lean()
  }

  static async count(company_id, filters = {}) {
    const { status, search, created_by } = filters
    const query = { company_id }
    if (status && status !== 'All') query.status = status
    if (created_by) query.created_by = created_by
    if (search) {
      query.$or = [
        { retailer_name: { $regex: search, $options: 'i' } },
        { product_name:  { $regex: search, $options: 'i' } },
        { enq_code:      { $regex: search, $options: 'i' } },
      ]
    }
    return EnquiryModel.countDocuments(query)
  }

  static async findById(id, company_id) {
    return EnquiryModel.findOne({ _id: id, company_id })
      .populate('product_id', 'image_urls')
      .lean()
  }

  static async create(data) {
    const {
      company_id, retailer_name, retailer_mobile, retailer_email,
      location, product_id, product_code, product_name,
      qty, unit, offered_price, remarks, created_by,
    } = data
    const enq_code = await getNextEnqCode()
    const enq = await EnquiryModel.create({
      enq_code, company_id,
      retailer_name, retailer_mobile, retailer_email: retailer_email || '',
      location: location || '',
      product_id: product_id || null, product_code: product_code || '',
      product_name: product_name || '',
      qty, unit: unit || 'Sq Ft', offered_price: offered_price || null,
      remarks: remarks || '',
      status: 'New', created_by,
    })
    return enq.toObject()
  }

  static async update(id, company_id, data) {
    const { status, distributor_reply, negotiation_note, offered_price, order_id, remarks } = data
    const VALID = ['New', 'Viewed', 'Replied', 'Negotiation', 'Confirmed', 'Cancelled']
    const updates = {}
    if (status && VALID.includes(status)) updates.status = status
    if (distributor_reply !== undefined) updates.distributor_reply = distributor_reply
    if (negotiation_note  !== undefined) updates.negotiation_note  = negotiation_note
    if (offered_price     !== undefined) updates.offered_price     = offered_price
    if (remarks           !== undefined) updates.remarks           = remarks
    if (order_id)                        updates.order_id          = order_id
    return EnquiryModel.findOneAndUpdate({ _id: id, company_id }, updates, { new: true }).lean()
  }

  static async delete(id, company_id) {
    const result = await EnquiryModel.deleteOne({ _id: id, company_id })
    return result.deletedCount > 0
  }

  static async getStatusStats(company_id) {
    const rows = await EnquiryModel.aggregate([
      { $match: { company_id: new mongoose.Types.ObjectId(company_id) } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ])
    return rows.reduce((acc, r) => ({ ...acc, [r._id]: r.count }), {})
  }

  static async getNextId() {
    return getNextEnqCode()
  }
}

module.exports = Enquiry
module.exports.EnquiryModel = EnquiryModel
