/**
 * One-time migration: renumber all existing companies to the sequential
 * EZY### scheme in registration order (oldest created_at first), then set
 * the shared counter so new registrations continue after the last one.
 *
 * Run once:  node src/utils/migrateCompanyCodes.js
 *
 * Safe to re-run: it always reassigns EZY001..EZYnnn by created_at order and
 * resets the counter to the company count.
 */
require('dotenv').config()
const mongoose = require('mongoose')
const Company = require('../models/Company Management/Company')
const Counter = require('../models/System Management/Counter')

const PREFIX = 'EZY'
const PAD = 3
const COMPANY_KEY = 'company'

function codeFor(n) {
  return `${PREFIX}${String(n).padStart(PAD, '0')}`
}

async function run() {
  const uri = process.env.MONGO_URI
  if (!uri) {
    console.error('MONGO_URI not set in environment (.env)')
    process.exit(1)
  }

  await mongoose.connect(uri, { dbName: 'ezyenquiry' })
  console.log('[migrate] connected')

  const companies = await Company.find({}, { company_code: 1, created_at: 1 })
    .sort({ created_at: 1, _id: 1 })
    .lean()

  console.log(`[migrate] found ${companies.length} companies`)

  // Two-phase update to avoid transient unique-index collisions:
  // 1) move everything to a temporary unique code
  // 2) assign the final sequential EZY### codes
  for (const c of companies) {
    await Company.updateOne(
      { _id: c._id },
      { $set: { company_code: `TMP-${c._id}` } }
    )
  }

  let seq = 0
  for (const c of companies) {
    seq += 1
    const newCode = codeFor(seq)
    await Company.updateOne({ _id: c._id }, { $set: { company_code: newCode } })
    console.log(`[migrate] ${c.company_code || '(none)'} -> ${newCode}`)
  }

  // Point the counter at the last used number so the next code is seq+1.
  await Counter.findByIdAndUpdate(
    COMPANY_KEY,
    { $set: { seq } },
    { upsert: true }
  )
  console.log(`[migrate] counter '${COMPANY_KEY}' set to ${seq} (next: ${codeFor(seq + 1)})`)

  await mongoose.disconnect()
  console.log('[migrate] done')
}

run().catch(async (err) => {
  console.error('[migrate] failed:', err)
  try { await mongoose.disconnect() } catch { /* noop */ }
  process.exit(1)
})
