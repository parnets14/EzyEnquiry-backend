const { sendSuccess, sendError, paginate } = require('../utils/helpers')
const { Product, Category, Brand } = require('../models')
const { CategoryModel } = require('../models/Category')
const { ProductModel }  = require('../models/Product')
const { CompanyModel }  = require('../models/Company')
const mongoose          = require('mongoose')

// ── Helper: resolve company_id for any role ───────────────────
// Regular users   → req.user.company_id  (set by requireCompany middleware)
// Super Admin     → their own company_id first, then explicit param, then first company in DB
async function resolveCompanyId(req) {
  // Any user (including Super Admin) who has a company_id → use it directly
  if (req.user.company_id) return req.user.company_id.toString()

  // Super Admin without a company_id: accept explicit company_id from body or query
  const explicit = req.body?.company_id || req.query?.company_id
  if (explicit) return explicit

  // Super Admin fallback: use first registered company in DB
  const first = await CompanyModel.findOne({}).select('_id').lean()
  return first?._id?.toString() || null
}

// ── Helper: normalise FormData strings to proper JS types ────
function normaliseBody(body) {
  const bool = (v, def = false) => v === 'true' ? true : v === 'false' ? false : (v ?? def)
  const num  = (v, def = 0)    => v === '' || v === null || v === undefined ? def : (parseFloat(v) || def)
  const str  = (v, def = '')   => (v === null || v === undefined || v === 'null') ? def : String(v).trim()

  return {
    ...body,
    // numbers
    gst_percent:      num(body.gst_percent,      18),
    purchase_price:   num(body.purchase_price,    0),
    landing_cost:     num(body.landing_cost,      0),
    selling_price:    num(body.selling_price,     0),
    dealer_price:     num(body.dealer_price,      0),
    retail_price:     num(body.retail_price,      0),
    mrp:              num(body.mrp,               0),
    wholesale_rate:   num(body.wholesale_rate,    0),
    project_rate:     num(body.project_rate,      0),
    min_selling_rate: num(body.min_selling_rate,  0),
    min_stock_level:  num(body.min_stock_level,   0),
    reorder_level:    num(body.reorder_level,     0),
    pcs_per_box:      body.pcs_per_box    ? num(body.pcs_per_box,   null) : null,
    sqft_per_box:     body.sqft_per_box   ? num(body.sqft_per_box,  null) : null,
    weight_per_box:   body.weight_per_box ? num(body.weight_per_box,null) : null,
    // booleans
    is_active:       bool(body.is_active,       true),
    new_arrival:     bool(body.new_arrival,      false),
    featured:        bool(body.featured,         false),
    online_visible:  bool(body.online_visible,   true),
    dealer_visible:  bool(body.dealer_visible,   true),
    // strings — keep as-is but null-safe
    alias:           str(body.alias),
    hsn_code:        str(body.hsn_code),
    surface:         str(body.surface),
    thickness:       str(body.thickness),
    grade:           str(body.grade),
    tile_type:       str(body.tile_type),
    application:     str(body.application),
    anti_skid:       str(body.anti_skid),
    origin:          str(body.origin),
    manufacturer:    str(body.manufacturer),
    barcode:         str(body.barcode),
    design:          str(body.design),
    collection:      str(body.collection),
    sales_type:      str(body.sales_type,   'Regular Sale'),
    product_type:    str(body.product_type, 'Regular Product'),
  }
}
async function listCategories(req, res) {
  const company_id = await resolveCompanyId(req)
  if (!company_id) return sendError(res, 'No company found. Please register a company first.', 400)

  const cats = await Category.findAll(company_id)
  // Only top-level categories (parent_id is null)
  const topLevel = cats.filter(c => !c.parent_id)

  // Attach real product count per category from the database
  const catIds = topLevel.map(c => c._id)
  const productCounts = await ProductModel.aggregate([
    { $match: { company_id: new mongoose.Types.ObjectId(company_id.toString()), category_id: { $in: catIds } } },
    { $group: { _id: '$category_id', count: { $sum: 1 } } },
  ])
  const countMap = {}
  productCounts.forEach(r => { countMap[r._id.toString()] = r.count })

  const result = topLevel.map(c => ({
    ...c,
    product_count: countMap[c._id.toString()] || 0,
  }))

  sendSuccess(res, result)
}

async function createCategory(req, res) {
  const company_id = await resolveCompanyId(req)
  if (!company_id) return sendError(res, 'No company found. Please register a company first.', 400)
  const { name, code, description } = req.body
  if (!name) return sendError(res, 'Category name is required.')
  const cat = await Category.create(company_id, { name, code, parent_id: null, description })
  sendSuccess(res, cat, 'Category created.', 201)
}

async function updateCategory(req, res) {
  const company_id = await resolveCompanyId(req)
  if (!company_id) return sendError(res, 'No company found.', 400)
  const { name, code, description, is_active } = req.body
  // Fetch existing so we never unset required fields on a toggle-only call
  const existing = await Category.findById(req.params.id, company_id)
  if (!existing) return sendError(res, 'Category not found.', 404)
  const cat = await Category.update(req.params.id, company_id, {
    name:        name        !== undefined ? name        : existing.name,
    code:        code        !== undefined ? code        : (existing.code || ''),
    description: description !== undefined ? description : (existing.description || ''),
    is_active:   is_active   !== undefined ? is_active   : existing.is_active,
    parent_id:   null,
  })
  if (!cat) return sendError(res, 'Category not found.', 404)
  sendSuccess(res, cat, 'Category updated.')
}

async function deleteCategory(req, res) {
  const company_id = await resolveCompanyId(req)
  if (!company_id) return sendError(res, 'No company found.', 400)
  // Prevent delete if sub-categories exist
  const children = await CategoryModel.countDocuments({ company_id, parent_id: req.params.id })
  if (children > 0) return sendError(res, 'Cannot delete: category has sub-categories. Delete them first.', 400)
  const deleted = await Category.delete(req.params.id, company_id)
  if (!deleted) return sendError(res, 'Category not found.', 404)
  sendSuccess(res, null, 'Category deleted.')
}

// ── Sub-Categories ────────────────────────────────────────────
async function listSubCategories(req, res) {
  const company_id = await resolveCompanyId(req)
  if (!company_id) return sendError(res, 'No company found.', 400)
  const { categoryId } = req.query
  const query = { company_id, parent_id: { $ne: null } }
  if (categoryId) query.parent_id = categoryId

  const subs = await CategoryModel.find(query).sort({ name: 1 }).lean()

  // Attach parent_name
  const parentIds = [...new Set(subs.map(s => s.parent_id?.toString()).filter(Boolean))]
  let parentMap = {}
  if (parentIds.length) {
    const parents = await CategoryModel.find({ _id: { $in: parentIds } }).lean()
    parents.forEach(p => { parentMap[p._id.toString()] = p.name })
  }

  const result = subs.map(s => ({
    ...s,
    category_name: parentMap[s.parent_id?.toString()] || null,
  }))
  sendSuccess(res, result)
}

async function createSubCategory(req, res) {
  const company_id = await resolveCompanyId(req)
  if (!company_id) return sendError(res, 'No company found. Please register a company first.', 400)
  const { category_id, name, code, description, is_active } = req.body
  if (!category_id) return sendError(res, 'Category is required.')
  if (!name)        return sendError(res, 'Sub-category name is required.')
  if (!code)        return sendError(res, 'Sub-category code is required.')

  // Verify parent category exists, belongs to company, and is active
  const parent = await CategoryModel.findOne({ _id: category_id, company_id }).lean()
  if (!parent)          return sendError(res, 'Selected category not found.', 404)
  if (!parent.is_active) return sendError(res, 'Selected category is inactive.', 400)
  if (parent.parent_id)  return sendError(res, 'Cannot create a sub-category under another sub-category.', 400)

  // Duplicate check: same name under same parent
  const dup = await CategoryModel.findOne({
    company_id,
    parent_id: category_id,
    name: { $regex: `^${name.trim()}$`, $options: 'i' },
  }).lean()
  if (dup) return sendError(res, `Sub-category "${name}" already exists for this category.`, 409)

  const sub = await CategoryModel.create({
    company_id,
    name:        name.trim(),
    parent_id:   category_id,
    description: description || '',
    is_active:   is_active !== false,
    code:        code.trim(),
  })
  sendSuccess(res, sub.toObject(), 'Sub-category created.', 201)
}

async function updateSubCategory(req, res) {
  const company_id = await resolveCompanyId(req)
  if (!company_id) return sendError(res, 'No company found.', 400)
  const { category_id, name, code, description, is_active } = req.body
  const sub = await CategoryModel.findOne({ _id: req.params.id, company_id }).lean()
  if (!sub) return sendError(res, 'Sub-category not found.', 404)

  // If changing parent category, validate new parent
  const newParentId = category_id || sub.parent_id?.toString()
  if (category_id && category_id !== sub.parent_id?.toString()) {
    const parent = await CategoryModel.findOne({ _id: category_id, company_id }).lean()
    if (!parent)          return sendError(res, 'Selected category not found.', 404)
    if (!parent.is_active) return sendError(res, 'Selected category is inactive.', 400)
    if (parent.parent_id)  return sendError(res, 'Cannot move sub-category under another sub-category.', 400)
  }

  // Duplicate check (exclude self)
  if (name) {
    const dup = await CategoryModel.findOne({
      _id: { $ne: req.params.id },
      company_id,
      parent_id: newParentId,
      name: { $regex: `^${name.trim()}$`, $options: 'i' },
    }).lean()
    if (dup) return sendError(res, `Sub-category "${name}" already exists for this category.`, 409)
  }

  const updated = await CategoryModel.findOneAndUpdate(
    { _id: req.params.id, company_id },
    {
      ...(name        && { name: name.trim() }),
      ...(code        && { code: code.trim() }),
      ...(description !== undefined && { description }),
      ...(category_id && { parent_id: category_id }),
      ...(is_active   !== undefined && { is_active: is_active !== false }),
    },
    { new: true }
  ).lean()

  sendSuccess(res, updated, 'Sub-category updated.')
}

async function deleteSubCategory(req, res) {
  const company_id = await resolveCompanyId(req)
  if (!company_id) return sendError(res, 'No company found.', 400)
  const sub = await CategoryModel.findOne({ _id: req.params.id, company_id }).lean()
  if (!sub) return sendError(res, 'Sub-category not found.', 404)
  if (!sub.parent_id) return sendError(res, 'Use the category delete endpoint for top-level categories.', 400)

  await CategoryModel.deleteOne({ _id: req.params.id, company_id })
  sendSuccess(res, null, 'Sub-category deleted.')
}

// ── Brands ───────────────────────────────────────────────────
async function listBrands(req, res) {
  const company_id = await resolveCompanyId(req)
  if (!company_id) return sendError(res, 'No company found.', 400)
  const brands = await Brand.findAll(company_id)
  sendSuccess(res, brands)
}

async function createBrand(req, res) {
  const company_id = await resolveCompanyId(req)
  if (!company_id) return sendError(res, 'No company found. Please register a company first.', 400)
  const { name, code, description } = req.body
  if (!name) return sendError(res, 'Brand name is required.')
  const brand = await Brand.create(company_id, { name, code, description })
  sendSuccess(res, brand, 'Brand created.', 201)
}

async function updateBrand(req, res) {
  const company_id = await resolveCompanyId(req)
  if (!company_id) return sendError(res, 'No company found.', 400)
  const { name, code, description, is_active } = req.body
  const brand = await Brand.update(req.params.id, company_id, { name, code, description, is_active })
  if (!brand) return sendError(res, 'Brand not found.', 404)
  sendSuccess(res, brand, 'Brand updated.')
}

async function deleteBrand(req, res) {
  const company_id = await resolveCompanyId(req)
  if (!company_id) return sendError(res, 'No company found.', 400)
  const deleted = await Brand.delete(req.params.id, company_id)
  if (!deleted) return sendError(res, 'Brand not found.', 404)
  sendSuccess(res, null, 'Brand deleted.')
}

// ── Products ─────────────────────────────────────────────────
async function listProducts(req, res) {
  const { page = 1, limit = 20, search, brand, category, sub_category, finish, material, is_active } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)

  const total    = await Product.count(req.user.company_id, { search, brand, category, sub_category, finish, material, is_active })
  const products = await Product.findAll(req.user.company_id, { search, brand, category, sub_category, finish, material, is_active, limit: parseInt(limit), offset })

  sendSuccess(res, { products, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

async function getProduct(req, res) {
  const product = await Product.findById(req.params.id, req.user.company_id)
  if (!product) return sendError(res, 'Product not found.', 404)
  sendSuccess(res, product)
}

async function createProduct(req, res) {
  let { code, name, category_id, sub_category_id, brand_id } = req.body
  if (!name) return sendError(res, 'Product name is required.')

  // Auto-generate code if not provided
  if (!code || !code.trim()) {
    const ts   = Date.now().toString(36).toUpperCase()
    const rand = Math.random().toString(36).substring(2, 5).toUpperCase()
    code = `PRD-${ts}-${rand}`
    req.body.code = code
  }

  // Normalise "null" strings that come through FormData
  if (category_id     === 'null' || category_id     === '') category_id     = null
  if (sub_category_id === 'null' || sub_category_id === '') sub_category_id = null
  if (brand_id        === 'null' || brand_id        === '') brand_id        = null

  const existing = await Product.findByCode(code.trim(), req.user.company_id)
  if (existing) return sendError(res, `Product with code "${code}" already exists.`, 409)

  // Validate category
  if (category_id) {
    const cat = await CategoryModel.findOne({ _id: category_id, company_id: req.user.company_id }).lean()
    if (!cat)          return sendError(res, 'Selected category not found.', 404)
    if (!cat.is_active) return sendError(res, 'Selected category is inactive.', 400)
  }

  // Validate sub-category
  if (sub_category_id) {
    const sub = await CategoryModel.findOne({ _id: sub_category_id, company_id: req.user.company_id }).lean()
    if (!sub)           return sendError(res, 'Selected sub-category not found.', 404)
    if (!sub.is_active)  return sendError(res, 'Selected sub-category is inactive.', 400)
    if (!sub.parent_id)  return sendError(res, 'Selected sub-category is invalid.', 400)
    if (category_id && sub.parent_id.toString() !== category_id.toString())
      return sendError(res, 'Sub-category does not belong to the selected category.', 400)
  }

  // Validate brand
  if (brand_id) {
    const { BrandModel } = require('../models/Brand')
    const br = await BrandModel.findOne({ _id: brand_id, company_id: req.user.company_id }).lean()
    if (!br)          return sendError(res, 'Selected brand not found.', 404)
    if (!br.is_active) return sendError(res, 'Selected brand is inactive.', 400)
  }

  // Handle uploaded images (multipart/form-data)
  const uploadedUrls = (req.files || []).map(f => `/uploads/images/${f.filename}`)

  const product = await Product.create(req.user.company_id, {
    ...normaliseBody(req.body),
    brand_id, category_id, sub_category_id,
    image_urls: uploadedUrls,
  })
  sendSuccess(res, product, 'Product created.', 201)
}

async function updateProduct(req, res) {
  let { category_id, sub_category_id, brand_id } = req.body

  // Normalise "null" strings from FormData
  if (category_id     === 'null' || category_id     === '') category_id     = null
  if (sub_category_id === 'null' || sub_category_id === '') sub_category_id = null
  if (brand_id        === 'null' || brand_id        === '') brand_id        = null
  req.body.category_id     = category_id
  req.body.sub_category_id = sub_category_id
  req.body.brand_id        = brand_id

  // Validate category
  if (category_id) {
    const cat = await CategoryModel.findOne({ _id: category_id, company_id: req.user.company_id }).lean()
    if (!cat) return sendError(res, 'Selected category not found.', 404)
  }

  // Validate sub-category belongs to category
  if (sub_category_id) {
    const sub = await CategoryModel.findOne({ _id: sub_category_id, company_id: req.user.company_id }).lean()
    if (!sub)          return sendError(res, 'Selected sub-category not found.', 404)
    if (!sub.is_active) return sendError(res, 'Selected sub-category is inactive.', 400)
    if (!sub.parent_id) return sendError(res, 'Selected sub-category is invalid.', 400)
    if (category_id && sub.parent_id.toString() !== category_id.toString())
      return sendError(res, 'Sub-category does not belong to the selected category.', 400)
  }

  // Handle uploaded images
  const newlyUploadedUrls = (req.files || []).map(f => `/uploads/images/${f.filename}`)

  // Determine final image_urls:
  // 1. Start with whatever the frontend says the existing images should be (after removals)
  // 2. Then append any newly uploaded images
  let existingKept = undefined
  if (req.body.image_urls !== undefined) {
    try {
      existingKept = typeof req.body.image_urls === 'string'
        ? JSON.parse(req.body.image_urls)
        : Array.isArray(req.body.image_urls) ? req.body.image_urls : []
    } catch { existingKept = [] }
  }

  let image_urls = undefined
  if (existingKept !== undefined || newlyUploadedUrls.length > 0) {
    // If frontend didn't send image_urls at all, fetch current ones from DB
    if (existingKept === undefined) {
      const current = await Product.findById(req.params.id, req.user.company_id)
      existingKept = current?.image_urls || []
    }
    image_urls = [...existingKept, ...newlyUploadedUrls]
  }

  // Build update payload — exclude image_urls from req.body spread (we handle it separately)
  const { image_urls: _ignored, ...bodyRest } = normaliseBody(req.body)
  bodyRest.brand_id        = brand_id
  bodyRest.category_id     = category_id
  bodyRest.sub_category_id = sub_category_id

  const product = await Product.update(req.params.id, req.user.company_id, {
    ...bodyRest,
    ...(image_urls !== undefined && { image_urls }),
  })
  if (!product) return sendError(res, 'Product not found.', 404)
  sendSuccess(res, product, 'Product updated.')
}

// POST /api/products/:id/upload-image
async function uploadProductImage(req, res) {
  if (!req.files || req.files.length === 0)
    return sendError(res, 'No image file provided.', 400)

  const imageUrls = req.files.map(f => `/uploads/images/${f.filename}`)
  const product   = await Product.addImages(req.params.id, req.user.company_id, imageUrls)
  if (!product) return sendError(res, 'Product not found.', 404)
  sendSuccess(res, { image_urls: product.image_urls }, 'Image uploaded.')
}

async function deleteProduct(req, res) {
  // Soft delete — never runs a real DELETE
  const deleted = await Product.softDelete(req.params.id, req.user.company_id, req.user._id || req.user.id)
  if (!deleted) return sendError(res, 'Product not found.', 404)
  sendSuccess(res, null, 'Product moved to Recycle Bin.')
}

// POST /api/products/:id/restore
async function restoreProduct(req, res) {
  const restored = await Product.restore(req.params.id, req.user.company_id)
  if (!restored) return sendError(res, 'Product not found in Recycle Bin.', 404)
  sendSuccess(res, restored, 'Product restored successfully.')
}

// GET /api/products/recycle-bin
async function getRecycleBin(req, res) {
  const { search } = req.query
  const products = await Product.findDeleted(req.user.company_id, { search })
  sendSuccess(res, products)
}

// GET /api/products/:id/check-transactions
async function checkProductTransactions(req, res) {
  const id         = req.params.id
  const company_id = req.user.company_id

  // Check for references in orders, purchases, enquiries, sales
  let hasTransactions = false
  try {
    const mongoose = require('mongoose')
    const pid = new mongoose.Types.ObjectId(id.toString())

    const checks = await Promise.allSettled([
      mongoose.connection.db.collection('orders').countDocuments({ company_id: new mongoose.Types.ObjectId(company_id.toString()), product_id: pid }),
      mongoose.connection.db.collection('purchases').countDocuments({ company_id: new mongoose.Types.ObjectId(company_id.toString()), product_id: pid }),
      mongoose.connection.db.collection('enquiries').countDocuments({ company_id: new mongoose.Types.ObjectId(company_id.toString()), product_id: pid }),
      mongoose.connection.db.collection('sales').countDocuments({ company_id: new mongoose.Types.ObjectId(company_id.toString()), product_id: pid }),
      mongoose.connection.db.collection('inventories').countDocuments({ company_id: new mongoose.Types.ObjectId(company_id.toString()), product_id: pid }),
    ])

    hasTransactions = checks.some(r => r.status === 'fulfilled' && r.value > 0)
  } catch { hasTransactions = false }

  sendSuccess(res, { hasTransactions })
}

// ── Product Search (marketplace) ─────────────────────────────
async function searchProducts(req, res) {
  const { q, category, brand, finish, material, color, size, min_price, max_price, page = 1, limit = 20 } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)

  const total    = await Product.searchCount({ q, category, brand, finish, material, color, size, min_price, max_price })
  const products = await Product.search({ q, category, brand, finish, material, color, size, min_price, max_price, limit: parseInt(limit), offset })

  sendSuccess(res, { products, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

module.exports = {
  listCategories, createCategory, updateCategory, deleteCategory,
  listSubCategories, createSubCategory, updateSubCategory, deleteSubCategory,
  listBrands, createBrand, updateBrand, deleteBrand,
  listProducts, getProduct, createProduct, updateProduct, deleteProduct,
  searchProducts, uploadProductImage,
  restoreProduct, getRecycleBin, checkProductTransactions,
}
