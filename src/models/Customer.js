const mongoose = require('mongoose')

const customerSchema = new mongoose.Schema({
  company_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  name:         { type: String, required: true, trim: true },
  mobile:       { type: String, default: '' },
  email:        { type: String, default: '' },
  gst_number:   { type: String, default: '' },
  address:      { type: String, default: '' },
  city:         { type: String, default: '' },
  state:        { type: String, default: '' },
  biz_type:     { type: String, default: 'Retailer' },
  credit_limit: { type: Number, default: 0 },
  is_active:    { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })

customerSchema.index({ company_id: 1 })
customerSchema.index({ mobile: 1 })

const CustomerModel = mongoose.model('Customer', customerSchema)

class Customer {
  static async findAll(company_id, filters = {}) {
    const { search, limit = 20, offset = 0 } = filters
    const query = { company_id }
    if (search) {
      query.$or = [
        { name:   { $regex: search, $options: 'i' } },
        { mobile: { $regex: search, $options: 'i' } },
      ]
    }
    return CustomerModel.find(query).sort({ name: 1 }).skip(offset).limit(limit).lean()
  }

  static async count(company_id, filters = {}) {
    const { search } = filters
    const query = { company_id }
    if (search) {
      query.$or = [
        { name:   { $regex: search, $options: 'i' } },
        { mobile: { $regex: search, $options: 'i' } },
      ]
    }
    return CustomerModel.countDocuments(query)
  }

  static async findById(id, company_id) {
    return CustomerModel.findOne({ _id: id, company_id }).lean()
  }

  static async create(company_id, data) {
    const { name, mobile, email, gst_number, address, city, state, biz_type, credit_limit } = data
    const customer = await CustomerModel.create({
      company_id, name, mobile, email: email || '',
      gst_number: gst_number || '', address: address || '',
      city: city || '', state: state || '',
      biz_type: biz_type || 'Retailer', credit_limit: credit_limit || 0,
    })
    return customer.toObject()
  }

  static async update(id, company_id, data) {
    const { name, mobile, email, gst_number, address, city, state, biz_type, credit_limit, is_active } = data
    return CustomerModel.findOneAndUpdate(
      { _id: id, company_id },
      { name, mobile, email, gst_number, address, city, state, biz_type, credit_limit, is_active: is_active !== false },
      { new: true }
    ).lean()
  }

  static async delete(id, company_id) {
    const result = await CustomerModel.deleteOne({ _id: id, company_id })
    return result.deletedCount > 0
  }
}

module.exports = Customer
module.exports.CustomerModel = CustomerModel
