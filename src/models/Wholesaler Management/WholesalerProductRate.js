/**
 * WholesalerProductRate
 * Wholesaler apni khud ki dealer_rate / retail_rate set karta hai
 * kisi bhi product ke liye — bina us product ko edit kiye.
 *
 * One record per (wholesaler_company_id + product_id)
 */
const mongoose = require('mongoose')

const wholesalerProductRateSchema = new mongoose.Schema(
  {
    wholesaler_company_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
    },
    product_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    // Source company (product owner) — for quick lookup
    product_company_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
    },
    dealer_rate: { type: Number, default: 0 },
    retail_rate: { type: Number, default: 0 },
    notes:       { type: String, default: '' },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
)

// One rate record per wholesaler per product
wholesalerProductRateSchema.index(
  { wholesaler_company_id: 1, product_id: 1 },
  { unique: true }
)
wholesalerProductRateSchema.index({ product_id: 1 })

module.exports = mongoose.model('WholesalerProductRate', wholesalerProductRateSchema)
