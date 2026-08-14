const mongoose = require('mongoose')

// ── Stock Movement Schema ─────────────────────────────────────
// Every inventory change (Stock In, Stock Out, Transfer, Adjustment, Reversal)
// is recorded here as an immutable audit trail.
const stockMovementSchema = new mongoose.Schema({
  company_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  movement_code:  { type: String, default: '' },            // e.g. MOV-0001

  product_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  product_name:   { type: String, default: '' },
  product_code:   { type: String, default: '' },

  warehouse_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', default: null },
  warehouse_name: { type: String, default: '' },

  movement_type:  {
    type: String,
    enum: ['Stock In', 'Stock Out', 'Transfer In', 'Transfer Out', 'Adjustment', 'Reversal'],
    required: true,
  },

  quantity:       { type: Number, required: true },          // positive = in, negative = out
  previous_stock: { type: Number, default: 0 },
  new_stock:      { type: Number, default: 0 },
  unit:           { type: String, default: '' },

  reference_type: { type: String, default: '' },             // Purchase | Sale | Transfer | Manual
  reference_id:   { type: String, default: '' },             // purchase_code / sale_code / etc.

  supplier_id:    { type: mongoose.Schema.Types.ObjectId, default: null },
  supplier_name:  { type: String, default: '' },

  invoice_number: { type: String, default: '' },
  notes:          { type: String, default: '' },

  created_by:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  movement_date:  { type: Date, default: Date.now },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })

stockMovementSchema.index({ company_id: 1 })
stockMovementSchema.index({ product_id: 1, warehouse_id: 1 })
stockMovementSchema.index({ reference_type: 1, reference_id: 1 })

const StockMovementModel = mongoose.model('StockMovement', stockMovementSchema)

// ── Auto-generate movement code ───────────────────────────────
async function getNextMovementCode() {
  const last = await StockMovementModel.findOne({ movement_code: /^MOV-/ })
    .sort({ movement_code: -1 })
    .lean()
  if (!last?.movement_code) return 'MOV-0001'
  const num = parseInt(last.movement_code.split('-')[1], 10)
  return `MOV-${String(num + 1).padStart(4, '0')}`
}

class StockMovement {
  /**
   * Create a stock movement record.
   * @param {Object} data
   */
  static async create(data) {
    const code = await getNextMovementCode()
    const doc  = await StockMovementModel.create({
      ...data,
      movement_code: code,
    })
    return doc.toObject()
  }

  /**
   * List all movements for a company, optionally filtered.
   */
  static async findAll(company_id, filters = {}) {
    const { product_id, warehouse_id, movement_type, reference_type, reference_id, limit = 100, offset = 0 } = filters
    const query = { company_id }
    if (product_id)    query.product_id    = product_id
    if (warehouse_id)  query.warehouse_id  = warehouse_id
    if (movement_type) query.movement_type = movement_type
    if (reference_type) query.reference_type = reference_type
    if (reference_id)  query.reference_id  = reference_id

    return StockMovementModel.find(query)
      .sort({ movement_date: -1, created_at: -1 })
      .skip(offset)
      .limit(limit)
      .lean()
  }

  /**
   * Check if a Stock-In movement already exists for a given purchase reference.
   */
  static async purchaseStockInExists(company_id, reference_id) {
    return StockMovementModel.exists({
      company_id,
      reference_type: 'Purchase',
      reference_id,
      movement_type:  'Stock In',
    })
  }

  static async count(company_id, filters = {}) {
    const { product_id, warehouse_id, movement_type } = filters
    const query = { company_id }
    if (product_id)    query.product_id    = product_id
    if (warehouse_id)  query.warehouse_id  = warehouse_id
    if (movement_type) query.movement_type = movement_type
    return StockMovementModel.countDocuments(query)
  }
}

module.exports = StockMovement
module.exports.StockMovementModel = StockMovementModel
