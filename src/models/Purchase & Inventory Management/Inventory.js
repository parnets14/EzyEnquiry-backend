const mongoose = require('mongoose');

/**
 * Inventory Model — Stock Bucket System
 *
 * Stock lifecycle (status moves between buckets — never double-counted):
 *
 *   physical_stock  = available + reserved + picking + packed + blocked
 *                     (reduces ONLY at final dispatch)
 *   available_stock = stock that can be sold/allocated
 *   reserved_stock  = allocated for a confirmed order (available decreases)
 *   picking_stock   = warehouse staff is physically picking this order
 *   packed_stock    = packed and ready for dispatch
 *   blocked_stock   = damaged / QC hold / unusable
 *   dispatched_qty  = cumulative total dispatched (historical counter)
 *
 * Transitions:
 *   Order Confirmed  → available  → reserved
 *   Picking Started  → reserved   → picking
 *   Packing Done     → picking    → packed
 *   Dispatch         → packed     → (removed) + physical_stock -= qty
 *   Cancellation     → reserved/picking/packed → available (released)
 *   Stock In         → physical_stock += qty, available_stock += qty
 *   Block            → available   → blocked
 */
const inventorySchema = new mongoose.Schema(
  {
    company_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Company',   required: true },
    product_id:       { type: mongoose.Schema.Types.ObjectId, ref: 'Product',   required: true },
    warehouse_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', default: null },

    // ── Core stock buckets ──────────────────────────────────────────────────
    physical_stock:   { type: Number, default: 0, min: 0 }, // total physical in warehouse
    available_stock:  { type: Number, default: 0, min: 0 }, // sellable / allocatable
    reserved_stock:   { type: Number, default: 0, min: 0 }, // held for confirmed orders
    picking_stock:    { type: Number, default: 0, min: 0 }, // being picked
    packed_stock:     { type: Number, default: 0, min: 0 }, // packed, awaiting dispatch
    blocked_stock:    { type: Number, default: 0, min: 0 }, // damaged/QC blocked
    dispatched_qty:   { type: Number, default: 0, min: 0 }, // cumulative dispatched total

    // ── Legacy fields (kept for backward compatibility) ────────────────────
    stock_in:         { type: Number, default: 0 },
    stock_out:        { type: Number, default: 0 },
    current_stock:    { type: Number, default: 0 }, // mirrors physical_stock

    // ── Reorder / Alert ────────────────────────────────────────────────────
    low_stock_alert:  { type: Number, default: 50 }, // alert threshold on available_stock
    reorder_level:    { type: Number, default: 0 },  // minimum reorder level
    purchase_rate:    { type: Number, default: 0 },  // last purchase cost per unit (for COGS)
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

inventorySchema.index({ company_id: 1 });
inventorySchema.index({ product_id: 1, warehouse_id: 1 }, { unique: true });
inventorySchema.index({ company_id: 1, available_stock: 1 });

module.exports = mongoose.model('Inventory', inventorySchema);
