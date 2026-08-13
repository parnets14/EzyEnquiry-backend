const mongoose = require('mongoose')

const categorySchema = new mongoose.Schema({
  company_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  name:        { type: String, required: true, trim: true },
  code:        { type: String, trim: true, default: '' },
  parent_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
  description: { type: String, default: '' },
  is_active:   { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })

categorySchema.index({ company_id: 1 })

const CategoryModel = mongoose.model('Category', categorySchema)

class Category {
  static async findAll(company_id) {
    const cats = await CategoryModel.find({ company_id }).sort({ name: 1 }).lean()
    // Attach parent_name
    const idToName = {}
    cats.forEach(c => { idToName[c._id.toString()] = c.name })
    return cats.map(c => ({
      ...c,
      parent_name: c.parent_id ? (idToName[c.parent_id.toString()] || null) : null,
    }))
  }

  static async findById(id, company_id) {
    return CategoryModel.findOne({ _id: id, company_id }).lean()
  }

  static async create(company_id, data) {
    const { name, code, parent_id, description } = data
    const cat = await CategoryModel.create({
      company_id, name, code: code || '', parent_id: parent_id || null, description: description || ''
    })
    return cat.toObject()
  }

  static async update(id, company_id, data) {
    const { name, code, parent_id, description, is_active } = data
    return CategoryModel.findOneAndUpdate(
      { _id: id, company_id },
      { name, code: code || '', parent_id: parent_id || null, description, is_active: is_active !== false },
      { new: true }
    ).lean()
  }

  static async delete(id, company_id) {
    const result = await CategoryModel.deleteOne({ _id: id, company_id })
    return result.deletedCount > 0
  }
}

module.exports = Category
module.exports.CategoryModel = CategoryModel
