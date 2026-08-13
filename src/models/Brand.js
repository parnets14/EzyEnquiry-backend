const mongoose = require('mongoose')

const brandSchema = new mongoose.Schema({
  company_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  name:        { type: String, required: true, trim: true },
  code:        { type: String, trim: true, default: '' },
  description: { type: String, default: '' },
  is_active:   { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })

brandSchema.index({ company_id: 1 })

const BrandModel = mongoose.model('Brand', brandSchema)

class Brand {
  static async findAll(company_id) {
    return BrandModel.find({ company_id }).sort({ name: 1 }).lean()
  }

  static async findById(id, company_id) {
    return BrandModel.findOne({ _id: id, company_id }).lean()
  }

  static async create(company_id, data) {
    const { name, code, description } = data
    const brand = await BrandModel.create({ company_id, name, code: code || '', description: description || '' })
    return brand.toObject()
  }

  static async update(id, company_id, data) {
    const { name, code, description, is_active } = data
    const update = { is_active: is_active !== false }
    if (name        !== undefined) update.name        = name
    if (code        !== undefined) update.code        = code
    if (description !== undefined) update.description = description
    return BrandModel.findOneAndUpdate(
      { _id: id, company_id },
      update,
      { new: true }
    ).lean()
  }

  static async delete(id, company_id) {
    const result = await BrandModel.deleteOne({ _id: id, company_id })
    return result.deletedCount > 0
  }
}

module.exports = Brand
module.exports.BrandModel = BrandModel
