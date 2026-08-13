const mongoose = require('mongoose')

const companySchema = new mongoose.Schema({
  company_code:      { type: String, unique: true },
  name:              { type: String, required: true, trim: true },
  owner_name:        { type: String, default: '' },
  biz_type:          { type: String, default: 'Wholesaler' },
  mobile:            { type: String, default: '' },
  email:             { type: String, lowercase: true, trim: true },
  gst_number:        { type: String, default: '' },
  pan_number:        { type: String, default: '' },
  address:           { type: String, default: '' },
  city:              { type: String, default: '' },
  state:             { type: String, default: '' },
  pin_code:          { type: String, default: '' },
  subscription_plan: { type: String, default: 'Free' },
  status:            { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
  reject_reason:     { type: String, default: '' },
  reviewed_by:       { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  docs_gst:          { type: Boolean, default: false },
  docs_pan:          { type: Boolean, default: false },
  docs_address:      { type: Boolean, default: false },
  docs_biz:          { type: Boolean, default: false },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })

companySchema.index({ status: 1 })
companySchema.index({ subscription_plan: 1 })

const CompanyModel = mongoose.model('Company', companySchema)

class Company {
  static async findAll(filters = {}) {
    const { status, plan, limit = 20, offset = 0 } = filters
    const query = {}
    if (status && status !== 'All') query.status = status
    if (plan   && plan   !== 'All') query.subscription_plan = plan

    return CompanyModel.find(query).sort({ created_at: -1 }).skip(offset).limit(limit).lean()
  }

  static async count(filters = {}) {
    const { status, plan } = filters
    const query = {}
    if (status && status !== 'All') query.status = status
    if (plan   && plan   !== 'All') query.subscription_plan = plan
    return CompanyModel.countDocuments(query)
  }

  static async findById(id) {
    return CompanyModel.findById(id).lean()
  }

  static async create(data) {
    const {
      company_code, name, owner_name, biz_type, mobile, email,
      gst_number, pan_number, address, city, state, pin_code, subscription_plan,
    } = data
    const company = await CompanyModel.create({
      company_code, name, owner_name, biz_type: biz_type || 'Wholesaler',
      mobile, email: email?.toLowerCase(),
      gst_number: gst_number || '', pan_number, address: address || '',
      city: city || '', state: state || '', pin_code: pin_code || '',
      subscription_plan: subscription_plan || 'Free', status: 'Pending',
    })
    return company.toObject()
  }

  static async update(id, data) {
    const {
      name, owner_name, biz_type, mobile, email, gst_number,
      pan_number, address, city, state, pin_code, subscription_plan,
    } = data
    return CompanyModel.findByIdAndUpdate(
      id,
      { name, owner_name, biz_type, mobile, email, gst_number, pan_number, address, city, state, pin_code, subscription_plan },
      { new: true }
    ).lean()
  }

  static async approve(id, reviewedBy) {
    return CompanyModel.findByIdAndUpdate(id, { status: 'Approved', reviewed_by: reviewedBy }, { new: true }).lean()
  }

  static async reject(id, reason, reviewedBy) {
    return CompanyModel.findByIdAndUpdate(id, { status: 'Rejected', reject_reason: reason, reviewed_by: reviewedBy }, { new: true }).lean()
  }

  static async updateDocs(id, docs) {
    const { docs_gst, docs_pan, docs_address, docs_biz } = docs
    return CompanyModel.findByIdAndUpdate(
      id,
      { docs_gst: !!docs_gst, docs_pan: !!docs_pan, docs_address: !!docs_address, docs_biz: !!docs_biz },
      { new: true }
    ).lean()
  }

  static async delete(id) {
    const result = await CompanyModel.deleteOne({ _id: id })
    return result.deletedCount > 0
  }

  static async getNextCode() {
    const last = await CompanyModel.findOne({ company_code: /^COM-/ }).sort({ company_code: -1 }).lean()
    if (!last || !last.company_code) return 'COM-001'
    const lastNum = parseInt(last.company_code.replace('COM-', ''), 10)
    return `COM-${String(lastNum + 1).padStart(3, '0')}`
  }

  // Alias used in companyController
  static async getNextId() {
    return Company.getNextCode()
  }
}

module.exports = Company
module.exports.CompanyModel = CompanyModel
