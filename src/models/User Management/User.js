const mongoose = require('mongoose')

const userSchema = new mongoose.Schema(
  {
    company_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null },
    name:          { type: String, required: true, trim: true },
    email:         { type: String, required: true, unique: true, lowercase: true, trim: true },
    mobile:        { type: String, default: '' },
    password_hash: { type: String },
    role: {
      type: String,
      enum: ['Super Admin', 'Company Owner', 'Manager', 'Accountant', 'Sales Executive', 'Warehouse Staff', 'Retailer', 'Wholesaler'],
      default: 'Sales Executive',
    },
    is_active:          { type: Boolean, default: true },
    last_login:         { type: Date, default: null },
    email_verified_at:  { type: Date, default: null },
    mobile_verified_at: { type: Date, default: null },
    password_changed_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
)

userSchema.index({ company_id: 1 })
userSchema.index({ email: 1 })
userSchema.index({ mobile: 1 })

module.exports = mongoose.model('User', userSchema)
