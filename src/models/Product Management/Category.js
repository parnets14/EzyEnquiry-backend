const mongoose = require('mongoose')

const categorySchema = new mongoose.Schema(
  {
    company_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    name:        { type: String, required: true, trim: true },
    code:        { type: String, trim: true, default: '' },
    parent_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    description: { type: String, default: '' },
    is_active:   { type: Boolean, default: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
)

categorySchema.index({ company_id: 1 })
categorySchema.index({ company_id: 1, parent_id: 1 })

module.exports = mongoose.model('Category', categorySchema)
