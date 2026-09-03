const mongoose = require('mongoose')

/**
 * WholesalerQuotation
 * ────────────────────
 * A wholesaler raises a request for a product (either an existing catalog
 * product or a brand-new item they describe). The admin reviews it on the
 * dashboard and sends back a quotation (price). The wholesaler then Accepts
 * (→ places an order / purchase) or Rejects it.
 *
 * Lifecycle: Requested → Quoted → Accepted (→ Ordered) | Rejected
 */
const wholesalerQuotationSchema = new mongoose.Schema(
  {
    company_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true }, // the wholesaler's company
    request_no:   { type: String, default: '' },   // WQ-0001

    // ── Requested product ──
    product_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null }, // set if picked from catalog
    product_name: { type: String, default: '' },
    product_code: { type: String, default: '' },
    size:         { type: String, default: '' },
    finish:       { type: String, default: '' },
    color:        { type: String, default: '' },
    unit:         { type: String, default: 'Sq Ft' },
    requested_qty:   { type: Number, default: 0 },
    wholesaler_note: { type: String, default: '' },

    // ── Admin quote ──
    quoted_price: { type: Number, default: 0 },   // per unit
    quoted_gst:   { type: Number, default: 18 },
    quoted_total: { type: Number, default: 0 },
    quoted_by:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    quoted_at:    { type: Date, default: null },
    admin_note:   { type: String, default: '' },

    // ── Lifecycle ──
    status:       { type: String, enum: ['Requested', 'Quoted', 'Accepted', 'Rejected', 'Ordered'], default: 'Requested' },
    purchase_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Purchase', default: null }, // set when Accepted → order

    created_by:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
)

wholesalerQuotationSchema.index({ company_id: 1, status: 1 })
wholesalerQuotationSchema.index({ request_no: 1 })

module.exports = mongoose.model('WholesalerQuotation', wholesalerQuotationSchema)
