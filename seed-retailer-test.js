/**
 * seed-retailer-test.js
 * 
 * Run: node seed-retailer-test.js
 * 
 * Creates test data for the retailer app:
 * 1. A wholesaler company (Approved) with products visible on the marketplace
 * 2. A test retailer account (Approved) that can log in immediately
 * 
 * Login credentials:
 *   Retailer: mobile 9876543210 (use OTP login — dev mode returns OTP in response)
 *   Wholesaler: mobile 9988776655 (use admin panel or password login)
 */
require('dotenv').config()
const mongoose = require('mongoose')
const bcrypt   = require('bcryptjs')

const connectDB = require('./src/config/database')
const Company   = require('./src/models/Company Management/Company')
const User      = require('./src/models/User Management/User')
const Category  = require('./src/models/Product Management/Category')
const Brand     = require('./src/models/Product Management/Brand')
const Product   = require('./src/models/Product Management/Product')

async function seed() {
  await connectDB()
  console.log('Connected to MongoDB.')

  // ─── 1. Wholesaler company ──────────────────────────────────────────────────
  let wholesaler = await Company.findOne({ mobile: '9988776655', biz_type: 'Wholesaler' })
  if (!wholesaler) {
    wholesaler = await Company.create({
      company_code: 'WHL001',
      name: 'Kajaria Tiles Wholesale',
      owner_name: 'Rajesh Sharma',
      biz_type: 'Wholesaler',
      mobile: '9988776655',
      email: 'wholesaler@test.com',
      gst_number: '27AABCK1234F1Z5',
      city: 'Jaipur',
      state: 'Rajasthan',
      pin_code: '302001',
      status: 'Approved',
      is_active: true,
      subscription_plan: 'Gold',
    })
    console.log('✓ Wholesaler company created:', wholesaler.name)
  } else {
    // Ensure it's approved
    if (wholesaler.status !== 'Approved') {
      wholesaler.status = 'Approved'
      await wholesaler.save()
    }
    console.log('• Wholesaler company exists:', wholesaler.name)
  }

  // Wholesaler user
  let wholesalerUser = await User.findOne({ mobile: '9988776655' })
  if (!wholesalerUser) {
    wholesalerUser = await User.create({
      company_id: wholesaler._id,
      name: 'Rajesh Sharma',
      email: 'wholesaler@test.com',
      mobile: '9988776655',
      role: 'Company Owner',
      is_active: true,
      password_hash: await bcrypt.hash('test1234', 12),
    })
    console.log('✓ Wholesaler user created (mobile: 9988776655, password: test1234)')
  } else {
    console.log('• Wholesaler user exists:', wholesalerUser.name)
  }

  // ─── 2. Category and Brand ────────────────────────────────────────────────
  let category = await Category.findOne({ company_id: wholesaler._id, name: 'Floor Tiles' })
  if (!category) {
    category = await Category.create({ company_id: wholesaler._id, name: 'Floor Tiles', code: 'FLR', is_active: true })
    console.log('✓ Category created: Floor Tiles')
  }

  let brand = await Brand.findOne({ company_id: wholesaler._id, name: 'Kajaria' })
  if (!brand) {
    brand = await Brand.create({ company_id: wholesaler._id, name: 'Kajaria', code: 'KAJ', is_active: true })
    console.log('✓ Brand created: Kajaria')
  }

  // ─── 3. Products ──────────────────────────────────────────────────────────
  const productsData = [
    { code: 'KAJ-001', name: 'Marble Elegance 600x600', size: '600x600mm', finish: 'Glossy', color: 'White', material: 'Vitrified', selling_price: 45, retail_price: 55, mrp: 65, gst_percent: 18 },
    { code: 'KAJ-002', name: 'Rustic Wood 600x1200', size: '600x1200mm', finish: 'Matt', color: 'Brown', material: 'Porcelain', selling_price: 65, retail_price: 80, mrp: 95, gst_percent: 18 },
    { code: 'KAJ-003', name: 'Classic Beige 800x800', size: '800x800mm', finish: 'Glossy', color: 'Beige', material: 'Vitrified', selling_price: 55, retail_price: 70, mrp: 85, gst_percent: 18 },
    { code: 'KAJ-004', name: 'Slate Grey Anti-Skid', size: '300x300mm', finish: 'Anti-Skid', color: 'Grey', material: 'Ceramic', selling_price: 25, retail_price: 35, mrp: 42, gst_percent: 18 },
    { code: 'KAJ-005', name: 'Royal Gold 1200x2400', size: '1200x2400mm', finish: 'Polished', color: 'Gold', material: 'Marble', selling_price: 120, retail_price: 150, mrp: 180, gst_percent: 18 },
    { code: 'KAJ-006', name: 'Ocean Blue Mosaic', size: '300x300mm', finish: 'Glossy', color: 'Blue', material: 'Glass Mosaic', selling_price: 85, retail_price: 110, mrp: 130, gst_percent: 18 },
  ]

  let created = 0
  for (const p of productsData) {
    const exists = await Product.findOne({ company_id: wholesaler._id, code: p.code })
    if (exists) continue

    await Product.create({
      company_id: wholesaler._id,
      code: p.code,
      name: p.name,
      brand_id: brand._id,
      category_id: category._id,
      size: p.size,
      finish: p.finish,
      color: p.color,
      material: p.material,
      unit: 'Box',
      pcs_per_box: 4,
      sqft_per_box: 10.76,
      gst_percent: p.gst_percent,
      selling_price: p.selling_price,
      retail_price: p.retail_price,
      dealer_price: p.selling_price + 5,
      mrp: p.mrp,
      is_active: true,
      status: 'active',
      online_visible: true,
      new_arrival: p.code === 'KAJ-005' || p.code === 'KAJ-006',
      featured: p.code === 'KAJ-001' || p.code === 'KAJ-003',
    })
    created++
  }
  if (created) console.log(`✓ ${created} products created`)
  else console.log('• Products already exist')

  // ─── 4. Test Retailer ─────────────────────────────────────────────────────
  let retailer = await Company.findOne({ mobile: '9876543210', biz_type: 'Retailer' })
  if (!retailer) {
    retailer = await Company.create({
      company_code: 'RET001',
      name: 'Shree Tiles Shop',
      owner_name: 'Amit Patel',
      biz_type: 'Retailer',
      mobile: '9876543210',
      email: 'retailer@test.com',
      city: 'Ahmedabad',
      state: 'Gujarat',
      pin_code: '380001',
      status: 'Approved',
      is_active: true,
      subscription_plan: 'Free',
      addresses: [
        { label: 'Shop', address: '123 Market Road', city: 'Ahmedabad', state: 'Gujarat', pin_code: '380001', is_default: true },
        { label: 'Warehouse', address: '45 Industrial Area', city: 'Ahmedabad', state: 'Gujarat', pin_code: '380015', is_default: false },
      ],
    })
    console.log('✓ Retailer company created:', retailer.name)
  } else {
    if (retailer.status !== 'Approved') {
      retailer.status = 'Approved'
      await retailer.save()
    }
    console.log('• Retailer company exists:', retailer.name)
  }

  let retailerUser = await User.findOne({ mobile: '9876543210' })
  if (!retailerUser) {
    retailerUser = await User.create({
      company_id: retailer._id,
      name: 'Amit Patel',
      email: 'retailer@test.com',
      mobile: '9876543210',
      role: 'Retailer',
      is_active: true,
      password_hash: await bcrypt.hash('test1234', 12),
    })
    console.log('✓ Retailer user created (mobile: 9876543210, password: test1234)')
  } else {
    console.log('• Retailer user exists:', retailerUser.name)
  }

  console.log('\n════════════════════════════════════════════════════')
  console.log('  TEST DATA READY')
  console.log('════════════════════════════════════════════════════')
  console.log('')
  console.log('  Retailer Login:')
  console.log('    Mobile: 9876543210')
  console.log('    Method: OTP (dev mode returns OTP in response)')
  console.log('    OR Password: test1234')
  console.log('')
  console.log('  Wholesaler Login (admin panel):')
  console.log('    Mobile: 9988776655')
  console.log('    Password: test1234')
  console.log('')
  console.log('  Products: 6 tiles from Kajaria')
  console.log('  Retailer status: Approved (can browse + send enquiries)')
  console.log('════════════════════════════════════════════════════')

  await mongoose.disconnect()
  process.exit(0)
}

seed().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
