const bcrypt       = require('bcryptjs')
const User         = require('../models/User Management/User')
const Company      = require('../models/Company Management/Company')

// ── Seed Super Admin ──────────────────────────────────────────────────────────
/**
 * Creates the Super Admin user + a default company on first boot.
 * Credentials are read from .env:
 *   SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, SUPER_ADMIN_NAME, SUPER_ADMIN_COMPANY_NAME
 * Safe to run multiple times — skips if admin already exists and is linked.
 */
async function seedSuperAdmin() {
  try {
    const email    = process.env.SUPER_ADMIN_EMAIL    || 'ezyenquiry@gmail.com'
    const existing = await User.findOne({ email }).lean()

    if (existing) {
      if (!existing.company_id) {
        const company = await ensureDefaultCompany(email)
        await User.findByIdAndUpdate(existing._id, { company_id: company._id })
        console.log('[Seed] ✓ Super Admin linked to company —', company.name)
      } else {
        console.log('[Seed] Super Admin already exists — skipping.')
      }
      return
    }

    const company  = await ensureDefaultCompany(email)
    const password = process.env.SUPER_ADMIN_PASSWORD || 'ezyenquiry@123'
    const hash     = await bcrypt.hash(password, 12)

    await User.create({
      name:          process.env.SUPER_ADMIN_NAME || 'Super Admin',
      email,
      mobile:        '9000000000',
      password_hash: hash,
      role:          'Super Admin',
      company_id:    company._id,
      is_active:     true,
    })
    console.log(`[Seed] ✓ Super Admin created — ${email}`)
  } catch (err) {
    console.error('[Seed] ✗ Failed to seed Super Admin:', err.message)
  }
}

// ── Heal Orphan Users ─────────────────────────────────────────────────────────
/**
 * Assigns a company_id to any user that is missing one.
 * Runs on every boot — idempotent and safe.
 */
async function healOrphanUsers() {
  try {
    const company = await Company.findOne({}).sort({ created_at: 1 }).lean()
    if (!company) return // No company yet — nothing to heal

    const r1 = await User.updateMany(
      { company_id: { $exists: false } },
      { $set: { company_id: company._id } }
    )
    const r2 = await User.updateMany(
      { company_id: null },
      { $set: { company_id: company._id } }
    )
    const total = r1.modifiedCount + r2.modifiedCount
    if (total > 0) {
      console.log(`[Heal] ✓ Linked ${total} orphan user(s) to company "${company.name}"`)
    }
  } catch (err) {
    console.error('[Heal] ✗ Failed to heal orphan users:', err.message)
  }
}

// ── Internal helper ───────────────────────────────────────────────────────────
async function ensureDefaultCompany(email) {
  let company = await Company.findOne({}).sort({ created_at: 1 }).lean()
  if (!company) {
    company = await Company.create({
      company_code:      'COM-001',
      name:              process.env.SUPER_ADMIN_COMPANY_NAME || 'EzyEnquiry Pvt Ltd',
      owner_name:        process.env.SUPER_ADMIN_NAME         || 'Super Admin',
      biz_type:          'Wholesaler',
      mobile:            '9000000000',
      email,
      subscription_plan: 'Platinum',
      status:            'Approved',
    })
    console.log('[Seed] ✓ Default company created —', company.name)
  }
  return company
}

module.exports = { seedSuperAdmin, healOrphanUsers }
