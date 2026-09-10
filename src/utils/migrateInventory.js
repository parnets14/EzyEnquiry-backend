/**
 * migrateInventory.js
 *
 * Two-step startup migration — fully idempotent (safe on every restart).
 *
 * STEP 1 — Backfill bucket fields on existing records
 *   Old productController only set current_stock / stock_in on Inventory docs.
 *   Copy current_stock → physical_stock + available_stock so the bucket system works.
 *
 * STEP 2 — Create zero-stock stubs for products that have NO Inventory record
 *   Products created with opening_stock = 0 never got an Inventory document.
 *   Without a stub they are invisible in Inventory Management and stock adjustments
 *   cannot be applied to them. This step creates a zero-stock record for each one.
 */

const mongoose  = require('mongoose');
const Inventory = require('../models/Purchase & Inventory Management/Inventory');
const Product   = require('../models/Product Management/Product');
const Warehouse = require('../models/Purchase & Inventory Management/Warehouse');

async function migrateInventoryBuckets() {

  // ── STEP 1: Backfill physical_stock / available_stock ───────────────────
  try {
    const backfill = await Inventory.updateMany(
      {
        $expr: {
          $and: [
            { $gt:  ['$current_stock',  0] },
            { $lte: ['$physical_stock', 0] },
          ],
        },
      },
      [
        {
          $set: {
            physical_stock: { $max: ['$current_stock', 0] },
            available_stock: {
              $max: [
                {
                  $subtract: [
                    '$current_stock',
                    {
                      $add: [
                        { $ifNull: ['$reserved_stock', 0] },
                        { $ifNull: ['$picking_stock',  0] },
                        { $ifNull: ['$packed_stock',   0] },
                        { $ifNull: ['$blocked_stock',  0] },
                      ],
                    },
                  ],
                },
                0,
              ],
            },
          },
        },
      ]
    );

    if (backfill.modifiedCount > 0) {
      console.log(`[migrateInventory] Step 1 ✓ Backfilled ${backfill.modifiedCount} record(s) → physical_stock + available_stock`);
    } else {
      console.log('[migrateInventory] Step 1 ✓ All records already have bucket fields');
    }
  } catch (err) {
    console.error('[migrateInventory] Step 1 ✗ (non-fatal):', err.message);
  }

  // ── STEP 2: Create Inventory stubs for products with NO record ───────────
  try {
    // All product_ids that already have at least one Inventory record
    const existingProductIds = await Inventory.distinct('product_id');

    // All active products NOT in that list
    const orphanProducts = await Product.find({
      status: { $ne: 'deleted' },
      _id:    { $nin: existingProductIds },
    })
      .select('_id company_id min_stock_level reorder_level purchase_price')
      .lean();

    if (orphanProducts.length === 0) {
      console.log('[migrateInventory] Step 2 ✓ All products already have an Inventory record');
      return;
    }

    // Find one active warehouse per company to use as default location
    const companyIds = [...new Set(
      orphanProducts.map(p => String(p.company_id)).filter(Boolean)
    )];

    const warehouseMap = {};
    await Promise.all(
      companyIds.map(async cid => {
        const wh = await Warehouse.findOne({
          company_id: new mongoose.Types.ObjectId(cid),
          is_active:  true,
        }).select('_id').lean().catch(() => null);
        if (wh) warehouseMap[cid] = wh._id;
      })
    );

    // Build zero-stock stub documents
    const stubs = orphanProducts.map(p => ({
      company_id:      p.company_id,
      product_id:      p._id,
      warehouse_id:    warehouseMap[String(p.company_id)] || null,
      physical_stock:  0,
      available_stock: 0,
      reserved_stock:  0,
      picking_stock:   0,
      packed_stock:    0,
      blocked_stock:   0,
      dispatched_qty:  0,
      stock_in:        0,
      stock_out:       0,
      current_stock:   0,
      low_stock_alert: p.min_stock_level || 0,
      reorder_level:   p.reorder_level   || 0,
      purchase_rate:   p.purchase_price  || 0,
    }));

    // ordered:false so a single duplicate key doesn't abort the whole batch
    const result = await Inventory.insertMany(stubs, { ordered: false })
      .catch(err => {
        // E11000 duplicate key — some stubs already exist, skip them
        if (err.code === 11000 || err?.writeErrors?.length) {
          return { length: err?.result?.nInserted ?? 0 };
        }
        throw err;
      });

    const inserted = Array.isArray(result) ? result.length : (result?.length ?? 0);
    console.log(`[migrateInventory] Step 2 ✓ Created ${inserted} zero-stock stub(s) for existing products`);

  } catch (err) {
    console.error('[migrateInventory] Step 2 ✗ (non-fatal):', err.message);
  }
}

module.exports = { migrateInventoryBuckets };
