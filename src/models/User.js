const mongoose = require('mongoose')

const userSchema = new mongoose.Schema({
  company_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Company' },
  name:       { type: String, required: true, trim: true },
  email:      { type: String, required: true, lowercase: true, trim: true, unique: true },
  mobile:     { type: String, default: '' },
  password_hash: { type: String },
  role:       { type: String, enum: ['Super Admin', 'Company Owner', 'Manager', 'Accountant', 'Sales Executive', 'Warehouse Staff', 'Retailer', 'Wholesaler'], default: 'Sales Executive' },
  is_active:  { type: Boolean, default: true },
  last_login: { type: Date },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })

userSchema.index({ company_id: 1 })
userSchema.index({ email: 1 })
userSchema.index({ mobile: 1 })

const UserModel = mongoose.model('User', userSchema)

class User {
  static async findAll(company_id, filters = {}) {
    const { role, is_active, limit = 20, offset = 0 } = filters
    const query = { company_id }
    if (role)                   query.role      = role
    if (is_active !== undefined) query.is_active = is_active !== 'false'

    return UserModel.find(query)
      .select('-password_hash')
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(limit)
      .lean()
  }

  static async count(company_id, filters = {}) {
    const { role, is_active } = filters
    const query = { company_id }
    if (role)                   query.role      = role
    if (is_active !== undefined) query.is_active = is_active !== 'false'
    return UserModel.countDocuments(query)
  }

  static async findById(id, company_id) {
    const q = { _id: id }
    if (company_id) q.company_id = company_id
    return UserModel.findOne(q).select('-password_hash').lean()
  }

  static async findByEmail(email) {
    return UserModel.findOne({ email: email.toLowerCase().trim() }).lean()
  }

  static async findByEmailOrMobile(target) {
    return UserModel.findOne({ $or: [{ email: target }, { mobile: target }] })
      .select('-password_hash').lean()
  }

  static async create(data) {
    const { company_id, name, email, mobile, password_hash, role } = data
    const user = await UserModel.create({ company_id, name, email, mobile, password_hash, role })
    const { password_hash: _, ...safe } = user.toObject()
    return safe
  }

  static async update(id, company_id, data) {
    const { name, mobile, role, is_active } = data
    return UserModel.findOneAndUpdate(
      { _id: id, company_id },
      { name, mobile, role, is_active: is_active !== undefined ? is_active : true },
      { new: true }
    ).select('-password_hash').lean()
  }

  static async updatePassword(id, password_hash) {
    return UserModel.findByIdAndUpdate(id, { password_hash }).lean()
  }

  static async updateLastLogin(id) {
    await UserModel.findByIdAndUpdate(id, { last_login: new Date() })
  }

  static async delete(id, company_id) {
    const result = await UserModel.deleteOne({ _id: id, company_id })
    return result.deletedCount > 0
  }

  static async checkEmailExists(email) {
    const user = await UserModel.findOne({ email: email.toLowerCase() }).select('_id').lean()
    return !!user
  }

  static async checkMobileExists(mobile) {
    const user = await UserModel.findOne({ mobile }).select('_id').lean()
    return !!user
  }
}

module.exports = User
module.exports.UserModel = UserModel
