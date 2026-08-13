const mongoose = require('mongoose')

const leadSchema = new mongoose.Schema({
  company_id:           { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  name:                 { type: String, required: true },
  mobile:               { type: String, default: '' },
  email:                { type: String, default: '' },
  source:               { type: String, default: '' },
  notes:                { type: String, default: '' },
  status:               { type: String, enum: ['New', 'Contacted', 'Qualified', 'Converted', 'Lost'], default: 'New' },
  assigned_to:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  converted_customer_id:{ type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })

leadSchema.index({ company_id: 1, status: 1 })

const LeadModel = mongoose.model('Lead', leadSchema)

class Lead {
  static async findAll(company_id, filters = {}) {
    const { status, source, limit = 20, offset = 0 } = filters
    const query = { company_id }
    if (status && status !== 'All') query.status = status
    if (source && source !== 'All') query.source = source
    return LeadModel.find(query)
      .populate('assigned_to', 'name')
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(limit)
      .lean()
  }

  static async count(company_id, filters = {}) {
    const { status, source } = filters
    const query = { company_id }
    if (status && status !== 'All') query.status = status
    if (source && source !== 'All') query.source = source
    return LeadModel.countDocuments(query)
  }

  static async findById(id, company_id) {
    return LeadModel.findOne({ _id: id, company_id }).lean()
  }

  static async create(company_id, data) {
    const { name, mobile, email, source, notes, assigned_to } = data
    const lead = await LeadModel.create({
      company_id, name, mobile, email: email || '',
      source: source || '', notes: notes || '',
      assigned_to: assigned_to || null, status: 'New',
    })
    return lead.toObject()
  }

  static async update(id, company_id, data) {
    const { name, mobile, email, source, status, notes, assigned_to } = data
    return LeadModel.findOneAndUpdate(
      { _id: id, company_id },
      { name, mobile, email, source, status, notes, assigned_to: assigned_to || null },
      { new: true }
    ).lean()
  }

  static async markConverted(id, customer_id) {
    return LeadModel.findByIdAndUpdate(
      id,
      { status: 'Converted', converted_customer_id: customer_id },
      { new: true }
    ).lean()
  }

  static async delete(id, company_id) {
    const result = await LeadModel.deleteOne({ _id: id, company_id })
    return result.deletedCount > 0
  }
}

module.exports = Lead
module.exports.LeadModel = LeadModel
