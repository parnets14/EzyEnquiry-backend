const mongoose = require('mongoose')

const branchSchema = new mongoose.Schema({
  company_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  code:       { type: String, trim: true, default: '' },
  name:       { type: String, required: true, trim: true },
  city:       { type: String, default: '' },
  state:      { type: String, default: '' },
  address:    { type: String, default: '' },
  manager:    { type: String, default: '' },
  phone:      { type: String, default: '' },
  email:      { type: String, default: '' },
  type:       { type: String, default: '' },   // e.g. Head Office, Branch, Showroom
  status:     { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })

branchSchema.index({ company_id: 1 })

const BranchModel = mongoose.model('Branch', branchSchema)

class Branch {
  static async findAll(company_id, filters = {}) {
    const { status, search } = filters
    const query = { company_id }
    if (status && status !== 'All') query.status = status
    if (search) {
      query.$or = [
        { name:    { $regex: search, $options: 'i' } },
        { city:    { $regex: search, $options: 'i' } },
        { manager: { $regex: search, $options: 'i' } },
      ]
    }
    return BranchModel.find(query).sort({ created_at: -1 }).lean()
  }

  static async findById(id, company_id) {
    return BranchModel.findOne({ _id: id, company_id }).lean()
  }

  static async getNextCode(company_id) {
    const count = await BranchModel.countDocuments({ company_id })
    return `BR-${String(count + 1).padStart(3, '0')}`
  }

  static async create(company_id, data) {
    const { name, city, state, address, manager, phone, email, type, status } = data
    const code = await Branch.getNextCode(company_id)
    const branch = await BranchModel.create({
      company_id, code, name,
      city:    city    || '',
      state:   state   || '',
      address: address || '',
      manager: manager || '',
      phone:   phone   || '',
      email:   email   || '',
      type:    type    || '',
      status:  status  || 'Active',
    })
    return branch.toObject()
  }

  static async update(id, company_id, data) {
    const { name, city, state, address, manager, phone, email, type, status } = data
    const update = {}
    if (name    !== undefined) update.name    = name
    if (city    !== undefined) update.city    = city
    if (state   !== undefined) update.state   = state
    if (address !== undefined) update.address = address
    if (manager !== undefined) update.manager = manager
    if (phone   !== undefined) update.phone   = phone
    if (email   !== undefined) update.email   = email
    if (type    !== undefined) update.type    = type
    if (status  !== undefined) update.status  = status

    return BranchModel.findOneAndUpdate(
      { _id: id, company_id },
      update,
      { new: true }
    ).lean()
  }

  static async delete(id, company_id) {
    const result = await BranchModel.deleteOne({ _id: id, company_id })
    return result.deletedCount > 0
  }
}

module.exports = Branch
module.exports.BranchModel = BranchModel
