/**
 * run-migration.js
 * Run this ONCE to fix inventory stock buckets on the live database.
 *
 * Usage:  node run-migration.js
 */
require('dotenv').config()
const mongoose = require('mongoose')

const MONGO_URI = process.env.MONGO_URI

if (!MONGO_URI) {
  console.error('MONGO_URI not set in .env')
  process.exit(1)
}

async function run() {
  console.log('Connecting to MongoDB…')
  await mongoose.connect(MONGO_URI)
  console.log('Connected.')

  const Inventory = require('./src/models/Purchase & Inventory Management/Inventory')

  // 1. Backfill physical_stock + available_stock from current_stock
  //    Only touches records where current_stock > 0 but physical_stock = 0
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
          physical_stock:  { $max: ['$current_stock', 0] },
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
  )

  console.log(`\n✓ Backfilled ${backfill.modifiedCount} inventory record(s)`)

  // 2. Show current state
  const all = await Inventory.find({}).lean()
  console.log(`\nAll inventory records (${all.length} total):`)
  for (const inv of all) {
    console.log(`  _id: ${inv._id}`)
    console.log(`    product_id:      ${inv.product_id}`)
    console.log(`    current_stock:   ${inv.current_stock}`)
    console.log(`    available_stock: ${inv.available_stock}`)
    console.log(`    physical_stock:  ${inv.physical_stock}`)
    console.log(`    company_id:      ${inv.company_id}`)
    console.log('')
  }

  await mongoose.disconnect()
  console.log('Done.')
}

run().catch(err => {
  console.error('Migration failed:', err.message)
  process.exit(1)
})
