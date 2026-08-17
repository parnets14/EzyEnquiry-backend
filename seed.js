/**
 * EZYENQUIRY — Complete Seed Script (Tiles Industry)
 * Seeds all 28 modules with realistic demo data.
 * Run: node seed.js
 */
require('dotenv').config()
const mongoose = require('mongoose')
const bcrypt   = require('bcryptjs')

const d = (daysAgo) => {
  const dt = new Date()
  dt.setDate(dt.getDate() - daysAgo)
  return dt
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/ezyenquiry')
  console.log('✓ Connected to MongoDB')

  const UserModel              = require('./src/models/User Management/User')
  const CompanyModel           = require('./src/models/Company Management/Company')
  const CategoryModel          = require('./src/models/Product Management/Category')
  const BrandModel             = require('./src/models/Product Management/Brand')
  const ProductModel           = require('./src/models/Product Management/Product')
  const InventoryModel         = require('./src/models/Purchase & Inventory Management/Inventory')
  const WarehouseModel         = require('./src/models/Purchase & Inventory Management/Warehouse')
  const EnquiryModel           = require('./src/models/Marketplace Management/Enquiry')
  const OrderModel             = require('./src/models/Marketplace Management/Order')
  const DispatchModel          = require('./src/models/Marketplace Management/Dispatch')
  const CustomerModel          = require('./src/models/CRM Management/Customer')
  const LeadModel              = require('./src/models/CRM Management/Lead')
  const FollowupModel          = require('./src/models/CRM Management/Followup')
  const PurchaseModel          = require('./src/models/Purchase & Inventory Management/Purchase')
  const SupplierModel          = require('./src/models/Purchase & Inventory Management/Supplier')
  const SaleModel              = require('./src/models/Finance Management/Sale')
  const ExpenseModel           = require('./src/models/Finance Management/Expense')
  const ReceivableModel        = require('./src/models/Finance Management/Receivable')
  const PayableModel           = require('./src/models/Finance Management/Payable')
  const TransactionModel       = require('./src/models/Finance Management/Transaction')
  const EmployeeModel          = require('./src/models/HR Management/Employee')
  const NotificationModel      = require('./src/models/System Management/Notification')

  // ── Get or create the default company ───────────────────────
  let company = await CompanyModel.findOne({}).sort({ created_at: 1 }).lean()
  if (!company) {
    console.log('── No company found — creating default company…')
    company = await CompanyModel.create({
      company_code:      'COM-001',
      name:              'EzyEnquiry Pvt Ltd',
      owner_name:        process.env.SUPER_ADMIN_NAME || 'Arjun Kumar',
      biz_type:          'Wholesaler',
      mobile:            '9000000000',
      email:             process.env.SUPER_ADMIN_EMAIL || 'ezyenquiry@gmail.com',
      subscription_plan: 'Platinum',
      status:            'Approved',
    })
    console.log('✓ Default company created')
  }
  const cid = company._id
  console.log(`✓ Company: ${company.name}`)

  // ── Get or create super admin user ───────────────────────────
  let adminUser = await UserModel.findOne({ company_id: cid, role: 'Super Admin' }).lean()
  if (!adminUser) {
    adminUser = await UserModel.findOne({ company_id: cid }).lean()
  }
  if (!adminUser) {
    console.log('── No user found — creating Super Admin…')
    const bcrypt = require('bcryptjs')
    const hash = await bcrypt.hash(process.env.SUPER_ADMIN_PASSWORD || 'ezyenquiry@123', 12)
    adminUser = await UserModel.create({
      company_id:    cid,
      name:          process.env.SUPER_ADMIN_NAME || 'Arjun Kumar',
      email:         process.env.SUPER_ADMIN_EMAIL || 'ezyenquiry@gmail.com',
      mobile:        '9000000000',
      password_hash: hash,
      role:          'Super Admin',
      is_active:     true,
    })
    adminUser = adminUser.toObject()
    console.log('✓ Super Admin created')
  }
  const uid = adminUser._id

  // ── Clear existing data ─────────────────────────────────────
  console.log('── Clearing existing seed data…')
  await Promise.all([
    ProductModel.deleteMany({ company_id: cid }),
    CategoryModel.deleteMany({ company_id: cid }),
    BrandModel.deleteMany({ company_id: cid }),
    InventoryModel.deleteMany({ company_id: cid }),
    WarehouseModel.deleteMany({ company_id: cid }),
    EnquiryModel.deleteMany({ company_id: cid }),
    OrderModel.deleteMany({ company_id: cid }),
    DispatchModel.deleteMany({ company_id: cid }),
    CustomerModel.deleteMany({ company_id: cid }),
    LeadModel.deleteMany({ company_id: cid }),
    FollowupModel.deleteMany({ company_id: cid }),
    PurchaseModel.deleteMany({ company_id: cid }),
    SupplierModel.deleteMany({ company_id: cid }),
    SaleModel.deleteMany({ company_id: cid }),
    ExpenseModel.deleteMany({ company_id: cid }),
    ReceivableModel.deleteMany({ company_id: cid }),
    PayableModel.deleteMany({ company_id: cid }),
    TransactionModel.deleteMany({ company_id: cid }),
    EmployeeModel.deleteMany({ company_id: cid }),
    NotificationModel.deleteMany({ company_id: cid }),
  ])
  console.log('✓ Cleared')

  // ════════════════════════════════════════════════════════════
  // 1. CATEGORIES
  // ════════════════════════════════════════════════════════════
  const cats = await CategoryModel.insertMany([
    { company_id: cid, name: 'Vitrified Tiles',    code: 'VIT', description: 'Premium vitrified floor tiles' },
    { company_id: cid, name: 'Ceramic Tiles',      code: 'CER', description: 'Standard ceramic floor & wall tiles' },
    { company_id: cid, name: 'Wall Tiles',         code: 'WAL', description: 'Decorative and standard wall tiles' },
    { company_id: cid, name: 'Outdoor & Parking',  code: 'OUT', description: 'Heavy-duty outdoor parking tiles' },
    { company_id: cid, name: 'Mosaic & Designer',  code: 'MOS', description: 'Decorative mosaic collections' },
    { company_id: cid, name: 'Bathroom Tiles',     code: 'BAT', description: 'Anti-skid bathroom floor tiles' },
  ])
  const subCats = await CategoryModel.insertMany([
    { company_id: cid, name: 'Double Charge', code: 'VIT-DC', parent_id: cats[0]._id },
    { company_id: cid, name: 'Full Body',     code: 'VIT-FB', parent_id: cats[0]._id },
    { company_id: cid, name: 'Kitchen Floor', code: 'CER-KF', parent_id: cats[1]._id },
    { company_id: cid, name: 'Kitchen Wall',  code: 'CER-KW', parent_id: cats[2]._id },
    { company_id: cid, name: 'Anti-Skid',     code: 'BAT-AS', parent_id: cats[5]._id },
  ])
  console.log(`✓ Categories: ${cats.length} + ${subCats.length} sub-categories`)

  // ════════════════════════════════════════════════════════════
  // 2. BRANDS
  // ════════════════════════════════════════════════════════════
  const brands = await BrandModel.insertMany([
    { company_id: cid, name: 'Kajaria',     code: 'KAJ', description: 'India\'s #1 tile brand' },
    { company_id: cid, name: 'Somany',      code: 'SOM', description: 'Premium tile manufacturer' },
    { company_id: cid, name: 'Johnson',     code: 'JOH', description: 'Quality ceramic tiles' },
    { company_id: cid, name: 'RAK',         code: 'RAK', description: 'RAK Ceramics India' },
    { company_id: cid, name: 'Orient Bell', code: 'OBL', description: 'Orient Bell Limited' },
    { company_id: cid, name: 'Asian Granito', code: 'AGA', description: 'Asian Granito India Ltd' },
  ])
  console.log(`✓ Brands: ${brands.length}`)

  // ════════════════════════════════════════════════════════════
  // 3. PRODUCTS (5 tile products matching erpStore catalogue)
  // ════════════════════════════════════════════════════════════
  const products = await ProductModel.insertMany([
    {
      company_id: cid, code: 'KAJ-VIT-800',
      name: 'Kajaria Vitrified Floor Tile 800×800mm',
      brand_id: brands[0]._id, category_id: cats[0]._id, sub_category_id: subCats[0]._id,
      size: '800×800', finish: 'Glossy', material: 'Vitrified', color: 'Ivory', unit: 'Sq Ft',
      description: 'Kajaria premium vitrified floor tile, double charge, anti-skid',
      purchase_price: 62, selling_price: 78, dealer_price: 72, retail_price: 88, mrp: 95, gst_percent: 18,
    },
    {
      company_id: cid, code: 'SOM-CER-600',
      name: 'Somany Ceramic Floor Tile 600×600mm',
      brand_id: brands[1]._id, category_id: cats[1]._id, sub_category_id: subCats[2]._id,
      size: '600×600', finish: 'Matte', material: 'Ceramic', color: 'Grey', unit: 'Sq Ft',
      description: 'Somany ceramic floor tile, matt finish, suitable for kitchen & bathroom floors',
      purchase_price: 32, selling_price: 42, dealer_price: 38, retail_price: 48, mrp: 52, gst_percent: 18,
    },
    {
      company_id: cid, code: 'JOH-WALL-300',
      name: 'Johnson Wall Tile 300×600mm',
      brand_id: brands[2]._id, category_id: cats[2]._id, sub_category_id: subCats[3]._id,
      size: '300×600', finish: 'Glossy', material: 'Ceramic', color: 'White', unit: 'Sq Ft',
      description: 'Johnson glossy white wall tile, suitable for bathroom & kitchen wall cladding',
      purchase_price: 26, selling_price: 36, dealer_price: 32, retail_price: 42, mrp: 45, gst_percent: 18,
    },
    {
      company_id: cid, code: 'KAJ-PARK-400',
      name: 'Kajaria Outdoor Parking Tile 400×400mm',
      brand_id: brands[0]._id, category_id: cats[3]._id,
      size: '400×400', finish: 'Anti-Skid', material: 'Vitrified', color: 'Dark Grey', unit: 'Sq Ft',
      description: 'Heavy duty anti-skid outdoor parking tile, frost resistant',
      purchase_price: 44, selling_price: 58, dealer_price: 52, retail_price: 66, mrp: 72, gst_percent: 18,
    },
    {
      company_id: cid, code: 'SOM-MOS-MIX',
      name: 'Somany Mosaic Collection 300×300mm',
      brand_id: brands[1]._id, category_id: cats[4]._id,
      size: '300×300', finish: 'Glossy', material: 'Ceramic', color: 'Multicolor', unit: 'Sq Ft',
      description: 'Decorative mosaic collection, handcrafted look, ideal for feature walls',
      purchase_price: 75, selling_price: 95, dealer_price: 88, retail_price: 108, mrp: 120, gst_percent: 18,
    },
    {
      company_id: cid, code: 'RAK-BAT-300',
      name: 'RAK Bathroom Anti-Skid Tile 300×300mm',
      brand_id: brands[3]._id, category_id: cats[5]._id, sub_category_id: subCats[4]._id,
      size: '300×300', finish: 'Anti-Skid', material: 'Ceramic', color: 'Beige', unit: 'Sq Ft',
      description: 'RAK anti-skid bathroom floor tile, water resistant',
      purchase_price: 28, selling_price: 38, dealer_price: 34, retail_price: 44, mrp: 48, gst_percent: 18,
    },
  ])
  console.log(`✓ Products: ${products.length}`)

  // ════════════════════════════════════════════════════════════
  // 4. WAREHOUSES
  // ════════════════════════════════════════════════════════════
  const warehouses = await WarehouseModel.insertMany([
    { company_id: cid, name: 'Main Warehouse – Surat',    city: 'Surat',  state: 'Gujarat',     capacity: 50000, manager: 'Mahesh Patel',  mobile: '9898989898' },
    { company_id: cid, name: 'Branch Warehouse – Mumbai', city: 'Mumbai', state: 'Maharashtra', capacity: 20000, manager: 'Suresh Kumar',  mobile: '9876543200' },
    { company_id: cid, name: 'Branch Warehouse – Delhi',  city: 'Delhi',  state: 'Delhi',       capacity: 15000, manager: 'Ramesh Sharma', mobile: '9811122233' },
  ])
  console.log(`✓ Warehouses: ${warehouses.length}`)

  // ════════════════════════════════════════════════════════════
  // 5. INVENTORY (stock levels)
  // ════════════════════════════════════════════════════════════
  await InventoryModel.insertMany([
    { company_id: cid, product_id: products[0]._id, warehouse_id: warehouses[0]._id, stock_in: 2400, stock_out: 1000, current_stock: 1400, low_stock_alert: 200 },
    { company_id: cid, product_id: products[1]._id, warehouse_id: warehouses[0]._id, stock_in: 3200, stock_out: 800,  current_stock: 2400, low_stock_alert: 300 },
    { company_id: cid, product_id: products[2]._id, warehouse_id: warehouses[0]._id, stock_in: 1800, stock_out: 500,  current_stock: 1300, low_stock_alert: 150 },
    { company_id: cid, product_id: products[3]._id, warehouse_id: warehouses[1]._id, stock_in: 1200, stock_out: 2000, current_stock: 120,  low_stock_alert: 150 },
    { company_id: cid, product_id: products[4]._id, warehouse_id: warehouses[0]._id, stock_in: 400,  stock_out: 355,  current_stock: 45,   low_stock_alert: 50  },
    { company_id: cid, product_id: products[5]._id, warehouse_id: warehouses[1]._id, stock_in: 900,  stock_out: 200,  current_stock: 700,  low_stock_alert: 100 },
  ])
  console.log('✓ Inventory stocked')

  // ════════════════════════════════════════════════════════════
  // 6. SUPPLIERS
  // ════════════════════════════════════════════════════════════
  const suppliers = await SupplierModel.insertMany([
    { company_id: cid, name: 'Kajaria Ceramics Ltd',        mobile: '9000111222', email: 'sales@kajaria.com',   city: 'Delhi',   state: 'Delhi',      gst_number: '07AABCK1234A1Z5', credit_days: 30 },
    { company_id: cid, name: 'Somany Ceramics',             mobile: '9000222333', email: 'orders@somany.com',   city: 'Rewari',  state: 'Haryana',    gst_number: '06AABCS5678B2Z1', credit_days: 45 },
    { company_id: cid, name: 'Johnson Tiles Pvt Ltd',       mobile: '9000333444', email: 'sales@johnson.com',   city: 'Mumbai',  state: 'Maharashtra',gst_number: '27AABCJ9012C3Z4', credit_days: 30 },
    { company_id: cid, name: 'RAK Ceramics India Pvt Ltd',  mobile: '9000444555', email: 'info@rakceramics.com',city: 'Pune',    state: 'Maharashtra',gst_number: '27AABCR3456D4Z2', credit_days: 30 },
    { company_id: cid, name: 'Asian Granito Industries Ltd',mobile: '9000555666', email: 'orders@asian.com',    city: 'Ahmedabad',state:'Gujarat',    gst_number: '24AABCA7890E5Z9', credit_days: 60 },
  ])
  console.log(`✓ Suppliers: ${suppliers.length}`)

  // ════════════════════════════════════════════════════════════
  // 7. CUSTOMERS
  // ════════════════════════════════════════════════════════════
  const customers = await CustomerModel.insertMany([
    { company_id: cid, name: 'Ramesh Tiles Store',    mobile: '9876543210', email: 'ramesh@tiles.com',  city: 'Mumbai',    state: 'Maharashtra', gst_number: '27AABCR1111F1Z8', biz_type: 'Retailer',    credit_limit: 200000 },
    { company_id: cid, name: 'Sharma Traders',        mobile: '9812345678', email: 'sharma@traders.com',city: 'Pune',      state: 'Maharashtra', gst_number: '27AABCS2222G2Z7', biz_type: 'Retailer',    credit_limit: 150000 },
    { company_id: cid, name: 'Patel Tile World',      mobile: '9700022334', email: 'patel@tiles.com',   city: 'Ahmedabad', state: 'Gujarat',     gst_number: '24AABCP3333H3Z6', biz_type: 'Wholesaler',  credit_limit: 500000 },
    { company_id: cid, name: 'Gupta Enterprises',     mobile: '9800011223', email: 'gupta@ent.com',     city: 'Delhi',     state: 'Delhi',       gst_number: '07AABCG4444I4Z5', biz_type: 'Retailer',    credit_limit: 300000 },
    { company_id: cid, name: 'Singh Construction',    mobile: '9988776655', email: 'singh@const.com',   city: 'Chandigarh',state: 'Punjab',      gst_number: '03AABCS5555J5Z4', biz_type: 'Wholesaler',  credit_limit: 800000 },
    { company_id: cid, name: 'Mehta Interiors Pvt Ltd',mobile: '9977665544',email: 'mehta@int.com',     city: 'Surat',     state: 'Gujarat',     gst_number: '24AABCM6666K6Z3', biz_type: 'Retailer',    credit_limit: 100000 },
  ])
  console.log(`✓ Customers: ${customers.length}`)

  // ════════════════════════════════════════════════════════════
  // 8. PURCHASES (from suppliers → auto stock-in)
  // ════════════════════════════════════════════════════════════
  const calcPur = (qty, rate, gst = 18) => {
    const amount = qty * rate
    const gst_amount = Math.round(amount * gst / 100)
    return { amount, gst_amount, total_amount: amount + gst_amount }
  }
  const purchases = await PurchaseModel.insertMany([
    { company_id: cid, purchase_code: 'PUR-0001', supplier_id: suppliers[0]._id, supplier_name: 'Kajaria Ceramics Ltd',
      product_id: products[0]._id, product_code: 'KAJ-VIT-800', product_name: 'Kajaria Vitrified Floor Tile 800×800mm',
      qty: 2400, rate: 62, ...calcPur(2400, 62), warehouse_id: warehouses[0]._id,
      purchase_date: d(30), invoice_number: 'KAJ-INV-2026-001', status: 'Received', created_by: uid },
    { company_id: cid, purchase_code: 'PUR-0002', supplier_id: suppliers[1]._id, supplier_name: 'Somany Ceramics',
      product_id: products[1]._id, product_code: 'SOM-CER-600', product_name: 'Somany Ceramic Floor Tile 600×600mm',
      qty: 3200, rate: 32, ...calcPur(3200, 32), warehouse_id: warehouses[0]._id,
      purchase_date: d(28), invoice_number: 'SOM-INV-2026-045', status: 'Received', created_by: uid },
    { company_id: cid, purchase_code: 'PUR-0003', supplier_id: suppliers[2]._id, supplier_name: 'Johnson Tiles Pvt Ltd',
      product_id: products[2]._id, product_code: 'JOH-WALL-300', product_name: 'Johnson Wall Tile 300×600mm',
      qty: 1800, rate: 26, ...calcPur(1800, 26), warehouse_id: warehouses[0]._id,
      purchase_date: d(25), invoice_number: 'JOH-INV-2026-088', status: 'Received', created_by: uid },
    { company_id: cid, purchase_code: 'PUR-0004', supplier_id: suppliers[0]._id, supplier_name: 'Kajaria Ceramics Ltd',
      product_id: products[3]._id, product_code: 'KAJ-PARK-400', product_name: 'Kajaria Outdoor Parking Tile 400×400mm',
      qty: 1200, rate: 44, ...calcPur(1200, 44), warehouse_id: warehouses[1]._id,
      purchase_date: d(20), invoice_number: 'KAJ-INV-2026-002', status: 'Received', created_by: uid },
    { company_id: cid, purchase_code: 'PUR-0005', supplier_id: suppliers[1]._id, supplier_name: 'Somany Ceramics',
      product_id: products[4]._id, product_code: 'SOM-MOS-MIX', product_name: 'Somany Mosaic Collection 300×300mm',
      qty: 400, rate: 75, ...calcPur(400, 75), warehouse_id: warehouses[0]._id,
      purchase_date: d(15), invoice_number: 'SOM-INV-2026-046', status: 'Received', created_by: uid },
  ])
  console.log(`✓ Purchases: ${purchases.length}`)

  // ════════════════════════════════════════════════════════════
  // 9. ENQUIRIES
  // ════════════════════════════════════════════════════════════
  const enquiries = await EnquiryModel.insertMany([
    {
      company_id: cid, enq_code: 'ENQ-0001',
      retailer_name: 'Ramesh Tiles Store', retailer_mobile: '9876543210', retailer_email: 'ramesh@tiles.com',
      location: 'Mumbai, MH', product_id: products[0]._id, product_code: 'KAJ-VIT-800',
      product_name: 'Kajaria Vitrified Floor Tile 800×800mm',
      qty: 1000, unit: 'Sq Ft', offered_price: 78,
      status: 'Confirmed', distributor_reply: 'Available – 2400 Sq Ft in stock. Rate ₹80/Sq Ft. Delivery within 2 days.',
      negotiation_note: 'Retailer requested ₹77. Settled at ₹78.',
      created_by: uid, created_at: d(7),
    },
    {
      company_id: cid, enq_code: 'ENQ-0002',
      retailer_name: 'Sharma Traders', retailer_mobile: '9812345678',
      location: 'Pune, MH', product_id: products[1]._id, product_code: 'SOM-CER-600',
      product_name: 'Somany Ceramic Floor Tile 600×600mm',
      qty: 800, unit: 'Sq Ft', offered_price: 42,
      status: 'New', distributor_reply: '', negotiation_note: '',
      created_by: uid, created_at: d(5),
    },
    {
      company_id: cid, enq_code: 'ENQ-0003',
      retailer_name: 'Patel Tile World', retailer_mobile: '9700022334',
      location: 'Ahmedabad, GJ', product_id: products[2]._id, product_code: 'JOH-WALL-300',
      product_name: 'Johnson Wall Tile 300×600mm',
      qty: 500, unit: 'Sq Ft', offered_price: 36,
      status: 'Replied', distributor_reply: 'Available. Rate ₹37/Sq Ft. Minimum order 400 Sq Ft.',
      created_by: uid, created_at: d(4),
    },
    {
      company_id: cid, enq_code: 'ENQ-0004',
      retailer_name: 'Gupta Enterprises', retailer_mobile: '9800011223',
      location: 'Delhi, DL', product_id: products[3]._id, product_code: 'KAJ-PARK-400',
      product_name: 'Kajaria Outdoor Parking Tile 400×400mm',
      qty: 2000, unit: 'Sq Ft', offered_price: 58,
      status: 'Negotiation',
      distributor_reply: 'Rate ₹59/Sq Ft. Bulk discount available above 1500 Sq Ft.',
      negotiation_note: 'Counter offered ₹57. Negotiating.',
      created_by: uid, created_at: d(3),
    },
    {
      company_id: cid, enq_code: 'ENQ-0005',
      retailer_name: 'Singh Construction', retailer_mobile: '9988776655',
      location: 'Chandigarh, PB', product_id: products[4]._id, product_code: 'SOM-MOS-MIX',
      product_name: 'Somany Mosaic Collection 300×300mm',
      qty: 300, unit: 'Sq Ft', offered_price: 95,
      status: 'Viewed', distributor_reply: '', negotiation_note: '',
      created_by: uid, created_at: d(1),
    },
    {
      company_id: cid, enq_code: 'ENQ-0006',
      retailer_name: 'Mehta Interiors', retailer_mobile: '9977665544',
      location: 'Surat, GJ', product_id: products[5]._id, product_code: 'RAK-BAT-300',
      product_name: 'RAK Bathroom Anti-Skid Tile 300×300mm',
      qty: 200, unit: 'Sq Ft', offered_price: 38,
      status: 'Cancelled', distributor_reply: 'Stock unavailable at this time.', negotiation_note: '',
      created_by: uid, created_at: d(6),
    },
  ])
  console.log(`✓ Enquiries: ${enquiries.length}`)

  // ════════════════════════════════════════════════════════════
  // 10. ORDERS
  // ════════════════════════════════════════════════════════════
  const calcOrder = (qty, rate, purRate = 0, gst = 18) => {
    const amount    = qty * rate
    const gst_amount = Math.round(amount * gst / 100)
    return { amount, gst_amount, total_amount: amount + gst_amount, purchase_cost: qty * purRate }
  }
  const orders = await OrderModel.insertMany([
    {
      company_id: cid, order_code: 'ORD-0001',
      enquiry_id: enquiries[0]._id, customer_id: customers[0]._id,
      customer_name: 'Ramesh Tiles Store', customer_mobile: '9876543210', location: 'Mumbai, MH',
      product_id: products[0]._id, product_code: 'KAJ-VIT-800',
      product_name: 'Kajaria Vitrified Floor Tile 800×800mm',
      qty: 1000, rate: 78, gst_percent: 18, ...calcOrder(1000, 78, 62),
      purchase_rate: 62, transport_cost: 3500, packing_cost: 1200,
      status: 'Delivered', due_date: d(4), created_by: uid, created_at: d(7),
    },
    {
      company_id: cid, order_code: 'ORD-0002',
      customer_id: customers[2]._id,
      customer_name: 'Patel Tile World', customer_mobile: '9700022334', location: 'Ahmedabad, GJ',
      product_id: products[1]._id, product_code: 'SOM-CER-600',
      product_name: 'Somany Ceramic Floor Tile 600×600mm',
      qty: 800, rate: 42, gst_percent: 18, ...calcOrder(800, 42, 32),
      purchase_rate: 32, transport_cost: 2000, packing_cost: 800,
      status: 'Dispatched', due_date: d(1), created_by: uid, created_at: d(5),
    },
    {
      company_id: cid, order_code: 'ORD-0003',
      customer_id: customers[4]._id,
      customer_name: 'Singh Construction', customer_mobile: '9988776655', location: 'Chandigarh, PB',
      product_id: products[3]._id, product_code: 'KAJ-PARK-400',
      product_name: 'Kajaria Outdoor Parking Tile 400×400mm',
      qty: 1200, rate: 58, gst_percent: 18, ...calcOrder(1200, 58, 44),
      purchase_rate: 44, transport_cost: 5000, packing_cost: 2000,
      status: 'Processing', due_date: d(-3), created_by: uid, created_at: d(3),
    },
    {
      company_id: cid, order_code: 'ORD-0004',
      customer_id: customers[1]._id,
      customer_name: 'Sharma Traders', customer_mobile: '9812345678', location: 'Pune, MH',
      product_id: products[2]._id, product_code: 'JOH-WALL-300',
      product_name: 'Johnson Wall Tile 300×600mm',
      qty: 500, rate: 36, gst_percent: 18, ...calcOrder(500, 36, 26),
      purchase_rate: 26, transport_cost: 1500, packing_cost: 500,
      status: 'Accepted', due_date: d(-5), created_by: uid, created_at: d(2),
    },
    {
      company_id: cid, order_code: 'ORD-0005',
      customer_id: customers[3]._id,
      customer_name: 'Gupta Enterprises', customer_mobile: '9800011223', location: 'Delhi, DL',
      product_id: products[0]._id, product_code: 'KAJ-VIT-800',
      product_name: 'Kajaria Vitrified Floor Tile 800×800mm',
      qty: 600, rate: 78, gst_percent: 18, ...calcOrder(600, 78, 62),
      purchase_rate: 62, transport_cost: 4000, packing_cost: 1000,
      status: 'New', due_date: d(-7), created_by: uid, created_at: d(1),
    },
  ])
  console.log(`✓ Orders: ${orders.length}`)
  // Link ENQ-0001 to ORD-0001
  await EnquiryModel.findByIdAndUpdate(enquiries[0]._id, { order_id: orders[0]._id })

  // ════════════════════════════════════════════════════════════
  // 11. DISPATCHES
  // ════════════════════════════════════════════════════════════
  const dispatches = await DispatchModel.insertMany([
    {
      company_id: cid, dispatch_code: 'DIS-0001',
      order_id: orders[0]._id, customer_name: 'Ramesh Tiles Store',
      vehicle_number: 'GJ05KA2266', driver_name: 'Raju Yadav', driver_mobile: '9988776655',
      transport_name: 'Shreeji Transport', lr_number: 'LR78901',
      dispatch_date: d(5), expected_delivery: d(3), delivered_date: d(2),
      status: 'Delivered', created_by: uid,
    },
    {
      company_id: cid, dispatch_code: 'DIS-0002',
      order_id: orders[1]._id, customer_name: 'Patel Tile World',
      vehicle_number: 'MH12BC3456', driver_name: 'Suresh Driver', driver_mobile: '9876500001',
      transport_name: 'VRL Logistics', lr_number: 'LR89012',
      dispatch_date: d(2), expected_delivery: d(-1),
      status: 'Dispatched', created_by: uid,
    },
  ])
  console.log(`✓ Dispatches: ${dispatches.length}`)
  // Link dispatches to orders
  await OrderModel.findByIdAndUpdate(orders[0]._id, { dispatch_id: dispatches[0]._id })
  await OrderModel.findByIdAndUpdate(orders[1]._id, { dispatch_id: dispatches[1]._id })

  // ════════════════════════════════════════════════════════════
  // 12. SALES (auto-created on delivery)
  // ════════════════════════════════════════════════════════════
  const sales = await SaleModel.insertMany([
    {
      company_id: cid, sale_code: 'SAL-0001',
      order_id: orders[0]._id, dispatch_id: dispatches[0]._id,
      customer_id: customers[0]._id, customer_name: 'Ramesh Tiles Store',
      product_id: products[0]._id, product_code: 'KAJ-VIT-800',
      product_name: 'Kajaria Vitrified Floor Tile 800×800mm',
      qty: 1000, rate: 78, amount: 78000, gst_amount: 14040, total_amount: 92040,
      payment_status: 'Pending', sale_date: d(2),
    },
  ])
  console.log(`✓ Sales: ${sales.length}`)

  // ════════════════════════════════════════════════════════════
  // 13. PAYMENTS — Receivables & Payables
  // ════════════════════════════════════════════════════════════
  const receivables = await ReceivableModel.insertMany([
    {
      company_id: cid, rcv_code: 'RCV-0001',
      customer_id: customers[0]._id, customer_name: 'Ramesh Tiles Store',
      order_id: orders[0]._id, sale_id: sales[0]._id,
      invoice_amount: 92040, received: 0, outstanding: 92040,
      due_date: d(-13), status: 'Pending',
    },
    {
      company_id: cid, rcv_code: 'RCV-0002',
      customer_id: customers[2]._id, customer_name: 'Patel Tile World',
      order_id: orders[1]._id,
      invoice_amount: 39571, received: 20000, outstanding: 19571,
      due_date: d(-5), status: 'Partial',
    },
  ])

  const payables = await PayableModel.insertMany([
    {
      company_id: cid, pay_code: 'PAY-0001',
      supplier_id: suppliers[0]._id, supplier_name: 'Kajaria Ceramics Ltd',
      purchase_id: purchases[0]._id,
      invoice_amount: 175584, paid: 175584, outstanding: 0,
      due_date: d(-15), status: 'Paid',
    },
    {
      company_id: cid, pay_code: 'PAY-0002',
      supplier_id: suppliers[1]._id, supplier_name: 'Somany Ceramics',
      purchase_id: purchases[1]._id,
      invoice_amount: 120832, paid: 0, outstanding: 120832,
      due_date: d(-10), status: 'Pending',
    },
    {
      company_id: cid, pay_code: 'PAY-0003',
      supplier_id: suppliers[2]._id, supplier_name: 'Johnson Tiles Pvt Ltd',
      purchase_id: purchases[2]._id,
      invoice_amount: 55224, paid: 0, outstanding: 55224,
      due_date: d(-8), status: 'Pending',
    },
  ])

  const transactions = await TransactionModel.insertMany([
    {
      company_id: cid, txn_code: 'TXN-0001', type: 'Paid',
      party_name: 'Kajaria Ceramics Ltd', reference_id: payables[0]._id,
      amount: 175584, mode: 'Bank Transfer', reference: 'NEFT20260704001',
      notes: 'Full payment for PUR-0001 (2400 Sq Ft Kajaria Vitrified Tile)',
      txn_date: d(20), recorded_by: uid,
    },
    {
      company_id: cid, txn_code: 'TXN-0002', type: 'Received',
      party_name: 'Patel Tile World', reference_id: receivables[1]._id,
      amount: 20000, mode: 'UPI', reference: 'UPI20260705002',
      notes: 'Partial payment received against RCV-0002',
      txn_date: d(3), recorded_by: uid,
    },
  ])
  console.log(`✓ Payments: ${receivables.length} receivables, ${payables.length} payables, ${transactions.length} transactions`)

  // ════════════════════════════════════════════════════════════
  // 14. EXPENSES
  // ════════════════════════════════════════════════════════════
  await ExpenseModel.insertMany([
    { company_id: cid, category: 'Rent',          amount: 45000, description: 'Warehouse rent – Main Surat',    expense_date: d(30), payment_mode: 'Bank Transfer', added_by: uid },
    { company_id: cid, category: 'Salary',        amount: 120000,description: 'Staff salaries August 2026',    expense_date: d(5),  payment_mode: 'Bank Transfer', added_by: uid },
    { company_id: cid, category: 'Electricity',   amount: 12500, description: 'Warehouse electricity bill',    expense_date: d(10), payment_mode: 'Online',        added_by: uid },
    { company_id: cid, category: 'Marketing',     amount: 25000, description: 'Google Ads & social media',     expense_date: d(15), payment_mode: 'Online',        added_by: uid },
    { company_id: cid, category: 'Transport',     amount: 8500,  description: 'Local delivery vehicle cost',   expense_date: d(8),  payment_mode: 'Cash',          added_by: uid },
    { company_id: cid, category: 'Office Supply', amount: 3200,  description: 'Stationery & printer ink',      expense_date: d(12), payment_mode: 'Cash',          added_by: uid },
    { company_id: cid, category: 'Maintenance',   amount: 7800,  description: 'Warehouse equipment servicing', expense_date: d(20), payment_mode: 'Cash',          added_by: uid },
    { company_id: cid, category: 'Insurance',     amount: 18000, description: 'Annual warehouse insurance',    expense_date: d(25), payment_mode: 'Cheque',        added_by: uid },
  ])
  console.log('✓ Expenses: 8 entries')

  // ════════════════════════════════════════════════════════════
  // 15. EMPLOYEES
  // ════════════════════════════════════════════════════════════
  await EmployeeModel.insertMany([
    { company_id: cid, emp_code: 'EMP-001', name: 'Mahesh Patel',    mobile: '9898989898', email: 'mahesh@ezy.com',   department: 'Warehouse', designation: 'Warehouse Manager',  join_date: d(365), salary: 35000 },
    { company_id: cid, emp_code: 'EMP-002', name: 'Priya Sharma',    mobile: '9812300001', email: 'priya@ezy.com',    department: 'Sales',     designation: 'Sales Executive',    join_date: d(300), salary: 28000 },
    { company_id: cid, emp_code: 'EMP-003', name: 'Rahul Verma',     mobile: '9812300002', email: 'rahul@ezy.com',    department: 'Sales',     designation: 'Sales Executive',    join_date: d(200), salary: 26000 },
    { company_id: cid, emp_code: 'EMP-004', name: 'Sunita Gupta',    mobile: '9812300003', email: 'sunita@ezy.com',   department: 'Accounts',  designation: 'Accountant',         join_date: d(400), salary: 32000 },
    { company_id: cid, emp_code: 'EMP-005', name: 'Vijay Kumar',     mobile: '9812300004', email: 'vijay@ezy.com',    department: 'Warehouse', designation: 'Warehouse Staff',    join_date: d(150), salary: 22000 },
    { company_id: cid, emp_code: 'EMP-006', name: 'Anita Singh',     mobile: '9812300005', email: 'anita@ezy.com',    department: 'Admin',     designation: 'Office Admin',       join_date: d(500), salary: 20000 },
  ])
  console.log('✓ Employees: 6 entries')

  // ════════════════════════════════════════════════════════════
  // 16. LEADS
  // ════════════════════════════════════════════════════════════
  const leads = await LeadModel.insertMany([
    { company_id: cid, name: 'Anil Mehta',     mobile: '9900112233', email: 'anil@gmail.com',   source: 'Google Ads',  notes: 'Interested in vitrified tiles for new project', status: 'New',       created_at: d(5) },
    { company_id: cid, name: 'Rekha Builders', mobile: '9900223344', email: 'rekha@build.com',  source: 'WhatsApp',    notes: 'Large order for residential complex',          status: 'Contacted', created_at: d(8) },
    { company_id: cid, name: 'Deepak Tiles Co',mobile: '9900334455', email: 'deepak@tiles.com', source: 'Instagram',   notes: 'Looking for mosaic tiles showroom display',    status: 'Qualified', created_at: d(12) },
    { company_id: cid, name: 'Kiran Interiors',mobile: '9900445566', email: 'kiran@int.com',    source: 'Referral',    notes: 'Interior designer, regular bulk buyer',        status: 'Converted', created_at: d(20) },
    { company_id: cid, name: 'Suresh Hardware', mobile: '9900556677',email: 'suresh@hw.com',    source: 'Facebook',    notes: 'Wants full range catalogue',                   status: 'New',       created_at: d(2) },
    { company_id: cid, name: 'Priya Constructions',mobile:'9900667788',email:'priya@con.com',   source: 'Website',     notes: 'Contacted for pricing of parking tiles',       status: 'Contacted', created_at: d(3) },
  ])
  console.log(`✓ Leads: ${leads.length}`)

  // ════════════════════════════════════════════════════════════
  // 17. FOLLOW-UPS
  // ════════════════════════════════════════════════════════════
  await FollowupModel.insertMany([
    { company_id: cid, lead_id: leads[0]._id, followup_date: d(-2), notes: 'Call to discuss pricing for vitrified tiles. Budget ~₹5L', status: 'Pending' },
    { company_id: cid, lead_id: leads[1]._id, followup_date: d(0),  notes: 'Send updated catalogue and bulk discount rates',         status: 'Pending' },
    { company_id: cid, lead_id: leads[2]._id, followup_date: d(3),  notes: 'Schedule showroom visit for mosaic tile samples',        status: 'Pending' },
    { company_id: cid, customer_id: customers[1]._id, followup_date: d(-5), notes: 'Follow up on pending payment of ₹19,571',      status: 'Missed'  },
    { company_id: cid, customer_id: customers[0]._id, followup_date: d(-7), notes: 'Confirm next order – repeat buyer',            status: 'Done', done_at: d(-6) },
  ])
  console.log('✓ Follow-ups: 5 entries')

  // ════════════════════════════════════════════════════════════
  // 18. NOTIFICATIONS
  // ════════════════════════════════════════════════════════════
  await NotificationModel.insertMany([
    { company_id: cid, type: 'enquiry',  title: 'New Enquiry — ENQ-0005', message: 'New enquiry from Singh Construction for Somany Mosaic × 300 Sq Ft', is_read: false, created_at: d(1) },
    { company_id: cid, type: 'order',   title: 'Order ORD-0002 Dispatched', message: 'Order for Patel Tile World dispatched via VRL Logistics. LR: LR89012', is_read: false, created_at: d(2) },
    { company_id: cid, type: 'payment', title: 'Payment Received — ₹20,000', message: '₹20,000 received from Patel Tile World against RCV-0002', is_read: true, created_at: d(3) },
    { company_id: cid, type: 'stock',   title: '⚠ Low Stock Alert — SOM-MOS-MIX', message: 'Somany Mosaic Collection has only 45 units left. Reorder recommended.', is_read: false, created_at: d(1) },
    { company_id: cid, type: 'stock',   title: '⚠ Low Stock Alert — KAJ-PARK-400', message: 'Kajaria Parking Tile 400×400 has only 120 units (alert: 150). Reorder soon.', is_read: false, created_at: d(2) },
    { company_id: cid, type: 'enquiry', title: 'New Enquiry — ENQ-0004', message: 'New enquiry from Gupta Enterprises for Kajaria Parking Tile × 2000 Sq Ft', is_read: true, created_at: d(3) },
    { company_id: cid, type: 'order',   title: 'Order ORD-0001 Delivered', message: 'Delivery confirmed for Ramesh Tiles Store. Sale SAL-0001 created automatically.', is_read: true, created_at: d(2) },
    { company_id: cid, type: 'payment', title: 'Payment Overdue — RCV-0001', message: 'Receivable of ₹92,040 from Ramesh Tiles Store is overdue by 13 days.', is_read: false, created_at: d(0) },
  ])
  console.log('✓ Notifications: 8 entries')

  // ════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════
  console.log('\n══════════════════════════════════════════════')
  console.log('  EZYENQUIRY SEED COMPLETE')
  console.log('══════════════════════════════════════════════')
  console.log(`  Company       : ${company.name}`)
  console.log('  Categories    : 6 + 5 sub-categories')
  console.log('  Brands        : 6')
  console.log('  Products      : 6 (tiles industry)')
  console.log('  Warehouses    : 3')
  console.log('  Inventory     : 6 stock records')
  console.log('  Suppliers     : 5')
  console.log('  Purchases     : 5  (₹5.49L total)')
  console.log('  Customers     : 6')
  console.log('  Enquiries     : 5')
  console.log('  Orders        : 5  (New/Accepted/Processing/Dispatched/Delivered)')
  console.log('  Dispatches    : 2')
  console.log('  Sales         : 1  (auto from delivered order)')
  console.log('  Receivables   : 2  (₹92,040 + ₹19,571 outstanding)')
  console.log('  Payables      : 3  (₹1.76L outstanding)')
  console.log('  Transactions  : 2')
  console.log('  Expenses      : 8  (₹2.4L total)')
  console.log('  Employees     : 6')
  console.log('  Leads         : 6')
  console.log('  Follow-ups    : 5')
  console.log('  Notifications : 8')
  console.log('══════════════════════════════════════════════\n')

  await mongoose.disconnect()
  console.log('✓ Done. Login: ezyenquiry@gmail.com / ezyenquiry@123')
}

main().catch(err => { console.error('✗ Seed failed:', err); process.exit(1) })
