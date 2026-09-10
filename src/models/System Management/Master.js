const mongoose = require('mongoose')

/**
 * Master — platform-wide standardized dropdown values managed by Super Admin.
 * Used by the Wholesaler App "Add Product" form so data stays consistent
 * across all companies (Category, Sub-Category, Brand, Finish, Size, Color, etc.).
 *
 * type: 'category' | 'sub_category' | 'brand' | 'finish' | 'size' | 'color' | 'material' | 'unit'
 * parent: for sub_category → the category name it belongs to (optional).
 */
const masterSchema = new mongoose.Schema(
  {
    type:      { type: String, required: true, index: true },
    name:      { type: String, required: true, trim: true },
    parent:    { type: String, default: '' },   // e.g. sub_category's category
    is_active: { type: Boolean, default: true },
    sort:      { type: Number, default: 0 },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
)

masterSchema.index({ type: 1, name: 1 }, { unique: true })

module.exports = mongoose.model('Master', masterSchema)
