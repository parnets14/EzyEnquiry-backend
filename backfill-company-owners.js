/**
 * Backfill missing "Company Owner" users so company-login works for every
 * approved company.
 *
 * Why: company-login looks up a User with role 'Company Owner' tied to the
 * company's mobile. Several companies were created without that owner user
 * (seed data / retailer-only flows), so login returned "No company is
 * registered with this mobile number" even though the company exists.
 *
 * This script, for every company that has a mobile but no Company Owner user,
 * creates one using company.mobile / company.owner_name / company.email.
 *
 * Safe to re-run: it skips companies that already have a Company Owner.
 *
 * Dry run (default): node backfill-company-owners.js
 * Apply changes:     node backfill-company-owners.js --apply
 */
require('dotenv').config()
const mongoose = require('mongoose')
const connectDB = require('./src/config/database')
const { Company, User } = require('./src/models')

const APPLY = process.argv.includes('--apply')

function slugEmail(company) {
  const base = (company.company_code || company.name || 'company')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24) || 'company'
  return `owner.${base}@placeholder.ezyenquiry.local`
}

;(async () => {
  await connectDB()
  console.log(`\n=== Backfill Company Owners  (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`)

  const companies = await Company.find({}).lean()
  let created = 0
  let skipped = 0

  for (const c of companies) {
    // Skip the platform admin company.
    if (c.company_code === 'ADMIN-001') { skipped++; continue }

    const existingOwner = await User.findOne({ company_id: c._id, role: 'Company Owner' }).lean()
    if (existingOwner) {
      console.log(`SKIP  ${c.name} (${c.company_code}) — already has Company Owner (${existingOwner.mobile})`)
      skipped++
      continue
    }

    const mobile = String(c.mobile || '').trim()
    if (!/^\d{10}$/.test(mobile)) {
      console.log(`WARN  ${c.name} (${c.company_code}) — invalid/missing company.mobile ("${c.mobile}"), cannot backfill`)
      skipped++
      continue
    }

    // Email must be unique. Prefer company.email if free, else a placeholder.
    let email = String(c.email || '').toLowerCase().trim()
    if (!email || await User.findOne({ email }).lean()) {
      email = slugEmail(c)
      // Ensure the placeholder is also free (in case of re-run collisions).
      let n = 1
      while (await User.findOne({ email }).lean()) {
        email = slugEmail(c).replace('@', `${n}@`)
        n++
      }
    }

    const doc = {
      company_id: c._id,
      name:       c.owner_name?.trim() || `${c.name} Owner`,
      email,
      mobile,
      role:       'Company Owner',
      is_active:  true,
    }

    console.log(`CREATE ${c.name} (${c.company_code}) → owner mobile=${mobile} email=${email}`)
    if (APPLY) {
      await User.create(doc)
    }
    created++
  }

  console.log(`\nDone. created=${created} skipped=${skipped}  ${APPLY ? '' : '(dry run — no changes written)'}`)
  await mongoose.disconnect()
  process.exit(0)
})().catch((e) => { console.error(e); process.exit(1) })
