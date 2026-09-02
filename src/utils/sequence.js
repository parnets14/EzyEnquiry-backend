const Counter = require('../models/System Management/Counter')
const Company = require('../models/Company Management/Company')

const COMPANY_KEY = 'company'
const COMPANY_PREFIX = 'EZY'
const COMPANY_PAD = 3 // EZY001 .. EZY999, then EZY1000+

/**
 * Extract the numeric part of any existing company_code.
 * Handles legacy formats like EZY0944302, RET4391040728, WHL001, COM-001.
 * Returns 0 when no digits are present.
 */
function numericPart(code) {
  if (!code) return 0
  const digits = String(code).replace(/\D/g, '')
  const n = parseInt(digits, 10)
  return Number.isFinite(n) ? n : 0
}

/**
 * One-time (idempotent) seed: make sure the counter starts at least at the
 * highest number already used by existing companies, so newly generated
 * codes never collide with legacy data.
 */
async function ensureCompanySeed() {
  const existing = await Counter.findById(COMPANY_KEY).lean()
  if (existing && existing.seq > 0) return

  // Find the current highest sequential EZY### number in use.
  const ezyCompanies = await Company.find(
    { company_code: new RegExp(`^${COMPANY_PREFIX}\\d+$`) },
    { company_code: 1 }
  ).lean()

  let max = 0
  for (const c of ezyCompanies) {
    const n = numericPart(c.company_code)
    if (n > max) max = n
  }

  await Counter.findByIdAndUpdate(
    COMPANY_KEY,
    { $max: { seq: max } },
    { upsert: true }
  )
}

/**
 * Atomically returns the next company code in registration order.
 * Format: EZY001, EZY002, EZY003, ... (shared across web + mobile).
 */
async function getNextCompanyCode() {
  await ensureCompanySeed()

  const counter = await Counter.findByIdAndUpdate(
    COMPANY_KEY,
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  )

  return `${COMPANY_PREFIX}${String(counter.seq).padStart(COMPANY_PAD, '0')}`
}

module.exports = { getNextCompanyCode }
