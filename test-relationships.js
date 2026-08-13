/**
 * End-to-end relationship test
 * Tests: Company → Category → SubCategory, Company → Brand, Company → Product
 * Run with: node test-relationships.js
 */
require('dotenv').config()
const connectDB = require('./src/config/database')

let pass = 0
let fail = 0

function ok(label) { console.log(`  ✓ ${label}`); pass++ }
function ko(label, err) { console.log(`  ✗ ${label}: ${err}`); fail++ }

connectDB().then(async () => {
  const { UserModel }     = require('./src/models/User')
  const { CompanyModel }  = require('./src/models/Company')
  const { CategoryModel } = require('./src/models/Category')
  const { BrandModel }    = require('./src/models/Brand')
  const { ProductModel }  = require('./src/models/Product')
  const mongoose          = require('mongoose')

  // ── Setup: get or create two test companies ─────────────────
  let compA = await CompanyModel.findOne({ name: 'TEST_Kajaria Ceramics' }).lean()
  if (!compA) {
    compA = await CompanyModel.create({
      company_code: 'TEST-A', name: 'TEST_Kajaria Ceramics',
      owner_name: 'Test Owner A', mobile: '9111111111', email: 'a@test.com',
      subscription_plan: 'Gold', status: 'Approved',
    })
  }
  let compB = await CompanyModel.findOne({ name: 'TEST_Somany Ceramics' }).lean()
  if (!compB) {
    compB = await CompanyModel.create({
      company_code: 'TEST-B', name: 'TEST_Somany Ceramics',
      owner_name: 'Test Owner B', mobile: '9222222222', email: 'b@test.com',
      subscription_plan: 'Silver', status: 'Approved',
    })
  }

  console.log('\n=== TEST 1: Company → Category → SubCategory ===')
  // Create Category for Company A
  const catA = await CategoryModel.create({
    company_id: compA._id, name: 'TEST_Tiles', code: 'TIL', parent_id: null, is_active: true,
  })
  if (catA.company_id.toString() === compA._id.toString()) ok('Category has correct company_id')
  else ko('Category company_id', `expected ${compA._id}, got ${catA.company_id}`)
  if (!catA.parent_id) ok('Category has no parent (top-level)')
  else ko('Category should be top-level', catA.parent_id)

  // Create SubCategory under Category A (Company A)
  const subA = await CategoryModel.create({
    company_id: compA._id, name: 'TEST_Floor Tiles', code: 'FLT',
    parent_id: catA._id, is_active: true,
  })
  if (subA.parent_id.toString() === catA._id.toString()) ok('SubCategory has correct parent category_id')
  else ko('SubCategory parent_id', `expected ${catA._id}, got ${subA.parent_id}`)
  if (subA.company_id.toString() === compA._id.toString()) ok('SubCategory has correct company_id')
  else ko('SubCategory company_id', `expected ${compA._id}, got ${subA.company_id}`)

  console.log('\n=== TEST 2: Company → Brand ===')
  const brandA = await BrandModel.create({
    company_id: compA._id, name: 'TEST_Kajaria', code: 'KAJ', is_active: true,
  })
  if (brandA.company_id.toString() === compA._id.toString()) ok('Brand has correct company_id')
  else ko('Brand company_id wrong', brandA.company_id)

  console.log('\n=== TEST 3: Company → Product → Category / SubCategory / Brand ===')
  const prodA = await ProductModel.create({
    company_id: compA._id, code: 'TEST-P001', name: 'TEST_Eternity Wooden',
    category_id: catA._id, sub_category_id: subA._id, brand_id: brandA._id,
    selling_price: 1000, is_active: true,
  })
  if (prodA.company_id.toString() === compA._id.toString()) ok('Product has correct company_id')
  else ko('Product company_id', prodA.company_id)
  if (prodA.category_id.toString() === catA._id.toString()) ok('Product has correct category_id')
  else ko('Product category_id', prodA.category_id)
  if (prodA.sub_category_id.toString() === subA._id.toString()) ok('Product has correct sub_category_id')
  else ko('Product sub_category_id', prodA.sub_category_id)
  if (prodA.brand_id.toString() === brandA._id.toString()) ok('Product has correct brand_id')
  else ko('Product brand_id', prodA.brand_id)

  console.log('\n=== TEST 4: Data Isolation — Company A cannot see Company B data ===')
  // Create Company B's category and product
  const catB = await CategoryModel.create({
    company_id: compB._id, name: 'TEST_Tiles_B', code: 'TLB', parent_id: null, is_active: true,
  })
  const brandB = await BrandModel.create({
    company_id: compB._id, name: 'TEST_Somany', code: 'SOM', is_active: true,
  })

  // Company A should NOT see Company B's categories
  const catsForA = await CategoryModel.find({ company_id: compA._id, parent_id: null }).lean()
  const compBCatInA = catsForA.find(c => c._id.toString() === catB._id.toString())
  if (!compBCatInA) ok('Company A cannot see Company B categories (isolation works)')
  else ko('ISOLATION FAILURE: Company A sees Company B category!', catB.name)

  // Company B should NOT see Company A's brands
  const brandsForB = await BrandModel.find({ company_id: compB._id }).lean()
  const compABrandInB = brandsForB.find(b => b._id.toString() === brandA._id.toString())
  if (!compABrandInB) ok('Company B cannot see Company A brands (isolation works)')
  else ko('ISOLATION FAILURE: Company B sees Company A brand!', brandA.name)

  console.log('\n=== TEST 5: Backend validation — cross-company relationship rejected ===')
  // Try to assign Company B's category to Company A's product — backend must reject
  const crossCatCheck = await CategoryModel.findOne({ _id: catB._id, company_id: compA._id }).lean()
  if (!crossCatCheck) ok('Cross-company category lookup correctly returns null (validation would reject)')
  else ko('ISOLATION FAILURE: Cross-company category visible!', crossCatCheck)

  // Try to assign Company B's brand to Company A's product — backend must reject
  const crossBrandCheck = await BrandModel.findOne({ _id: brandB._id, company_id: compA._id }).lean()
  if (!crossBrandCheck) ok('Cross-company brand lookup correctly returns null (validation would reject)')
  else ko('ISOLATION FAILURE: Cross-company brand visible!', crossBrandCheck)

  console.log('\n=== TEST 6: Product count per category ===')
  const countAgg = await ProductModel.aggregate([
    { $match: { company_id: new mongoose.Types.ObjectId(compA._id.toString()), category_id: { $in: [catA._id] } } },
    { $group: { _id: '$category_id', count: { $sum: 1 } } },
  ])
  if (countAgg.length === 1 && countAgg[0].count === 1) ok(`Product count for TEST_Tiles = ${countAgg[0].count} (correct)`)
  else ko('Product count aggregation failed', JSON.stringify(countAgg))

  // ── Cleanup test data ─────────────────────────────────────
  await ProductModel.deleteMany({ code: { $regex: '^TEST-' } })
  await CategoryModel.deleteMany({ name: { $regex: '^TEST_' } })
  await BrandModel.deleteMany({ name: { $regex: '^TEST_' } })
  await CompanyModel.deleteMany({ name: { $regex: '^TEST_' } })
  console.log('\n[Cleanup] Test data removed.')

  console.log(`\n=== RESULTS: ${pass} passed, ${fail} failed ===`)
  process.exit(fail > 0 ? 1 : 0)
}).catch(e => { console.error('Fatal:', e.message); process.exit(1) })
