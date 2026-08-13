const mongoose = require('mongoose')

const followupSchema = new mongoose.Schema({
  company_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  lead_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Lead',     default: null },
  customer_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
  followup_date: { type: Date, required: true },
  notes:         { type: String, default: '' },
  status:        { type: String, enum: ['Pending', 'Done', 'Missed'], default: 'Pending' },
  assigned_to:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  done_at:       { type: Date, default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })

followupSchema.index({ company_id: 1, status: 1 })

const FollowupModel = mongoose.model('Followup', followupSchema)

class Followup {
  static async findAll(company_id, filters = {}) {
    const { status, lead_id, customer_id, limit = 20, offset = 0 } = filters
    const query = { company_id }
    if (status)      query.status      = status
    if (lead_id)     query.lead_id     = lead_id
    if (customer_id) query.customer_id = customer_id
    return FollowupModel.find(query)
      .populate('lead_id', 'name')
      .populate('customer_id', 'name')
      .populate('assigned_to', 'name')
      .sort({ followup_date: 1 })
      .skip(offset)
      .limit(limit)
      .lean()
  }

  static async count(company_id, filters = {}) {
    const { status, lead_id, customer_id } = filters
    const query = { company_id }
    if (status)      query.status      = status
    if (lead_id)     query.lead_id     = lead_id
    if (customer_id) query.customer_id = customer_id
    return FollowupModel.countDocuments(query)
  }

  static async create(company_id, data) {
    const { lead_id, customer_id, followup_date, notes, assigned_to } = data
    const f = await FollowupModel.create({
      company_id,
      lead_id:     lead_id     || null,
      customer_id: customer_id || null,
      followup_date, notes: notes || '',
      assigned_to: assigned_to || null,
      status: 'Pending',
    })
    return f.toObject()
  }

  static async update(id, company_id, data) {
    const { followup_date, notes, status, done_at } = data
    return FollowupModel.findOneAndUpdate(
      { _id: id, company_id },
      { followup_date, notes, status, done_at: done_at || null },
      { new: true }
    ).lean()
  }

  static async delete(id, company_id) {
    const result = await FollowupModel.deleteOne({ _id: id, company_id })
    return result.deletedCount > 0
  }
}

module.exports = Followup
module.exports.FollowupModel = FollowupModel
