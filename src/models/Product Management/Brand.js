const mongoose = require('mongoose')

const brandSchema = new mongoose.Schema(
  {
    company_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    name:        { type: String, required: true, trim: true },
    code:        { type: String, trim: true, default: '' },
    description: { type: String, default: '' },
    is_active:   { type: Boolean, default: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
)

brandSchema.index({ company_id: 1 })

module.exports = mongoose.model('Brand', brandSchema)
