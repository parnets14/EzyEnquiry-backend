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
      // ── The Super Admin must NEVER share a company with a real business ──
      // Historically the first company it found was reused as "the admin
      // company", so the admin ended up inside a customer's company (seen in
      // production: Super Admin lived in a Wholesaler company). That breaks
      // broadcasts: `broadcastEnquiry` excludes the SENDER's own company, so
      // whenever the Admin sent, that customer was dropped as "itself" and
      // never received the enquiry — and the Admin had nowhere to receive into.
      //
      // So: if the admin's company looks like a real business (it exists, was
      // NOT created by this seeder, and other users belong to it), move the
      // admin onto a dedicated company instead of silently accepting it.
      const dedicated = await ensureDedicatedAdminCompany(email, existing)
      if (dedicated && String(existing.company_id || '') !== String(dedicated._id)) {
        await User.findByIdAndUpdate(existing._id, { company_id: dedicated._id })
        console.log('[Seed] ✓ Super Admin moved to dedicated company —', dedicated.name)
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

// ── Dedicated admin company ───────────────────────────────────────────────────
// Returns the company the Super Admin SHOULD own. Creates one if the admin has
// none, or if its current company is a real business (i.e. more than one user
// belongs to it, or it was not created by this helper).
async function ensureDedicatedAdminCompany(email, adminUser) {
  const ADMIN_NAME = process.env.SUPER_ADMIN_COMPANY_NAME || 'EzyEnquiry Admin'

  // Already on a dedicated company? (by name, and it is not shared)
  const byName = await Company.findOne({ name: ADMIN_NAME }).lean()
  if (byName) return byName

  if (adminUser.company_id) {
    const current = await Company.findById(adminUser.company_id).lean()
    // Safe to keep when the admin is the ONLY user in that company — it was
    // probably created for the admin in the first place.
    if (current) {
      const userCount = await User.countDocuments({ company_id: current._id })
      if (userCount <= 1) return current
    }
  }

  // Create a dedicated one.
  let code; let n = 0
  do { n++; code = `ADMIN-${String(n).padStart(3, '0')}` } while (await Company.exists({ company_code: code }))

  return Company.create({
    company_code:      code,
    name:              ADMIN_NAME,
    owner_name:        adminUser.name || 'Super Admin',
    biz_type:          'Wholesaler',      // kept a broadcast recipient
    mobile:            adminUser.mobile || '9000000000',
    email,
    subscription_plan: 'Platinum',
    status:            'Approved',
    is_active:         true,
    approved_at:       new Date(),
  })
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

/**
 * Seed platform-wide master dropdown values (Category/Brand/Finish/Size/…)
 * used by the Wholesaler App "Add Product" form. Runs once if empty.
 */
async function seedMasters() {
  try {
    const Master = require('../models/System Management/Master')
    const count = await Master.countDocuments()
    if (count > 0) return

    const defaults = {
      category:     ['Tiles', 'Granite', 'Marble', 'Sanitary', 'Bathroom Fittings', 'Adhesives'],
      sub_category: [
        { name: 'Floor Tiles', parent: 'Tiles' }, { name: 'Wall Tiles', parent: 'Tiles' },
        { name: 'Vitrified Tiles', parent: 'Tiles' }, { name: 'Granite Slab', parent: 'Granite' },
      ],
      brand:    ['Kajaria', 'Somany', 'Nitco', 'Johnson', 'Asian', 'Generic'],
      finish:   ['Glossy', 'Matt', 'Satin', 'Polished', 'Rustic', 'Sugar', 'Carving'],
      size:     ['300x300', '600x600', '300x600', '600x1200', '800x800', '24x24', '12x18'],
      color:    ['White', 'Ivory', 'Beige', 'Grey', 'Black', 'Brown', 'Blue'],
      material: ['Ceramic', 'Vitrified', 'Porcelain', 'Natural Stone'],
      unit:     ['Sq Ft', 'Box', 'Piece', 'Sq Mtr'],
    }

    const docs = []
    for (const [type, values] of Object.entries(defaults)) {
      values.forEach((v, i) => {
        if (typeof v === 'string') docs.push({ type, name: v, sort: i })
        else docs.push({ type, name: v.name, parent: v.parent || '', sort: i })
      })
    }
    await Master.insertMany(docs, { ordered: false }).catch(() => {})
    console.log(`[Seed] Master lists seeded (${docs.length} values).`)
  } catch (e) {
    console.warn('[Seed] seedMasters skipped:', e.message)
  }
}

module.exports = { seedSuperAdmin, healOrphanUsers, seedMasters }
