const mongoose = require('mongoose')

const branchSchema = new mongoose.Schema(
  {
    company_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    code:       { type: String, trim: true, default: '' },
    name:       { type: String, required: true, trim: true },
    city:       { type: String, default: '' },
    state:      { type: String, default: '' },
    address:    { type: String, default: '' },
    manager:    { type: String, default: '' },
    phone:      { type: String, default: '' },
    email:      { type: String, default: '' },
    type:       { type: String, default: '' }, // e.g. Head Office, Branch, Showroom
    status:     { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
)

branchSchema.index({ company_id: 1 })

module.exports = mongoose.model('Branch', branchSchema)
