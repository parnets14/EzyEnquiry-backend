const { sendSuccess, sendError, paginate } = require('../../utils/helpers')
const Product          = require('../../models/Product Management/Product')
const Category         = require('../../models/Product Management/Category')
const Brand            = require('../../models/Product Management/Brand')
const Inventory        = require('../../models/Purchase & Inventory Management/Inventory')
const Warehouse        = require('../../models/Purchase & Inventory Management/Warehouse')
const Company          = require('../../models/Company Management/Company')
const resolveCompanyId = require('../../utils/resolveCompany')
const mongoose         = require('mongoose')

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function productScope(req, extra = {}) {
  return req.user?.role === 'Super Admin'
    ? { ...extra }
    : { ...extra, company_id: req.user.company_id }
}

async function getCreatorType(req) {
  if (req.user?.role === 'Super Admin') return 'Admin'
  if (req.user?.role === 'Admin')       return 'Admin'   // company admin also counts as Admin
  if (req.user?.role === 'Retailer') return 'Retailer'
  if (req.user?.role === 'Wholesaler') return 'Wholesaler'

  const company = await Company.findById(req.user?.company_id).select('biz_type').lean()
  if (company?.biz_type === 'Retailer')   return 'Retailer'
  if (company?.biz_type === 'Wholesaler') return 'Wholesaler'
  return 'Admin'  // fallback: treat as Admin, not Wholesaler
}

// ── Helper: normalise FormData strings to proper JS types ─────
function normaliseBody(body) {
  const bool = (v, def = false) => v === 'true' ? true : v === 'false' ? false : (v ?? def)
  const num  = (v, def = 0)    => v === '' || v == null ? def : (parseFloat(v) || def)
  const str  = (v, def = '')   => (v == null || v === 'null') ? def : String(v).trim()

  return {
    ...body,
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
    retail_discount:    num(body.retail_discount,    0),
    dealer_discount:    num(body.dealer_discount,    0),
    wholesale_discount: num(body.wholesale_discount, 0),
    project_discount:   num(body.project_discount,   0),
    min_stock_level:  num(body.min_stock_level,   0),
    reorder_level:    num(body.reorder_level,     0),
    pcs_per_box:      body.pcs_per_box    ? num(body.pcs_per_box,    null) : null,
    sqft_per_box:     body.sqft_per_box   ? num(body.sqft_per_box,   null) : null,
    weight_per_box:   body.weight_per_box ? num(body.weight_per_box, null) : null,
    is_active:        bool(body.is_active,      true),
    new_arrival:      bool(body.new_arrival,     false),
    featured:         bool(body.featured,        false),
    online_visible:   bool(body.online_visible,  true),
    dealer_visible:   bool(body.dealer_visible,  true),
    alias:            str(body.alias),
    hsn_code:         str(body.hsn_code),
    surface:          str(body.surface),
    thickness:        str(body.thickness),
    grade:            str(body.grade),
    tile_type:        str(body.tile_type),
    application:      str(body.application),
    anti_skid:        str(body.anti_skid),
    origin:           str(body.origin),
    manufacturer:     str(body.manufacturer),
    barcode:          str(body.barcode),
    design:           str(body.design),
    collection:       str(body.collection),
    sales_type:       str(body.sales_type,   'Regular Sale'),
    product_type:     str(body.product_type, 'Regular Product'),
    ...parseAccessControl(body),
    ...parseDynamicSpecs(body),
  }
}

// ── Helper: parse category-driven dynamic fields ─────────────
// attributes arrives as a JSON string (FormData). category_type is a plain
// string. Both are optional and only included when submitted.
function parseDynamicSpecs(body) {
  const out = {}
  if (body.category_type !== undefined) {
    out.category_type = String(body.category_type || '').trim()
  }
  if (body.attributes !== undefined) {
    let attrs = body.attributes
    if (typeof attrs === 'string') {
      try { attrs = JSON.parse(attrs) } catch { attrs = {} }
    }
    out.attributes = (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) ? attrs : {}
  }
  return out
}

// ── Helper: parse per-company access-control fields ───────────
// allowed_company_codes arrives as a JSON string (FormData) or an array.
// Codes are normalised to trimmed UPPERCASE and de-duplicated.
function parseAccessControl(body) {
  const out = {}

  if (body.shared_with_all !== undefined) {
    out.shared_with_all = body.shared_with_all === 'true' || body.shared_with_all === true
  }

  if (body.allowed_company_codes !== undefined) {
    let list = body.allowed_company_codes
    if (typeof list === 'string') {
      try { list = JSON.parse(list) } catch { list = list.split(',') }
    }
    if (!Array.isArray(list)) list = list == null ? [] : [list]
    const codes = list
      .map(c => String(c || '').trim().toUpperCase())
      .filter(Boolean)
    out.allowed_company_codes = [...new Set(codes)]
  }

  return out
}

// ── Helper: null-out 'null' strings from FormData ─────────────
function nullifyIds(body) {
  const clean = (v) => (v === 'null' || v === '') ? null : v
  return {
    ...body,
    category_id:     clean(body.category_id),
    sub_category_id: clean(body.sub_category_id),
    brand_id:        clean(body.brand_id),
  }
}

/** GET /api/products */
async function listProducts(req, res) {
  const { page = 1, limit = 20, search, finish, material, sub_category, is_active, all_companies, source } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)

  // Super Admin may view products across ALL companies (incl. wholesaler-added)
  // by passing ?all_companies=true. Everyone else is scoped to their company.
  const seeAll = req.user.role === 'Super Admin' && String(all_companies) === 'true'
  const query = { status: { $ne: 'deleted' } }
  if (!seeAll) query.company_id = req.user.company_id
  // Optional source filter — e.g. only products added from the wholesaler app.
  if (source) query.source = source
  if (search)       query.$or = [{ name: { $regex: search, $options: 'i' } }, { code: { $regex: search, $options: 'i' } }]
  if (finish)       query.finish          = finish
  if (material)     query.material        = material
  if (sub_category) query.sub_category_id = sub_category
  if (is_active !== undefined) query.is_active = is_active !== 'false'

  const [total, products] = await Promise.all([
    Product.countDocuments(query),
    Product.find(query)
      .populate('brand_id', 'name')
      .populate('category_id', 'name')
      .populate('sub_category_id', 'name')
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(parseInt(limit))
      .lean(),
  ])

  console.log(`[Products] company_id=${query.company_id} total=${total} returning=${products.length} limit=${limit}`)
  sendSuccess(res, { products, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

/** GET /api/products/admin/all — Super Admin read-only cross-company catalogue */
async function listAllProducts(req, res) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1)
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 500)
  const offset = (page - 1) * limit
  const query = { status: { $ne: 'deleted' } }
  const search = String(req.query.search || '').trim()

  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i')
    const companyIds = await Company.find({
      $or: [{ name: regex }, { company_code: regex }, { biz_type: regex }],
    }).distinct('_id')
    query.$or = [
      { name: regex },
      { code: regex },
      { alias: regex },
      { company_id: { $in: companyIds } },
    ]
  }

  const [total, products] = await Promise.all([
    Product.countDocuments(query),
    Product.find(query)
      .populate('company_id', 'company_code name biz_type status is_active')
      .populate('created_by', 'name role')
      .populate('brand_id', 'name')
      .populate('category_id', 'name')
      .populate('sub_category_id', 'name')
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(limit)
      .lean(),
  ])

  sendSuccess(res, { products, pagination: paginate(total, page, limit) })
}

async function loadTaxonomy(companyId) {
  const [brands, categories] = await Promise.all([
    Brand.find({ company_id: companyId, is_active: true }).sort({ name: 1 }).lean(),
    Category.find({ company_id: companyId, is_active: true }).sort({ name: 1 }).lean(),
  ])
  return {
    brands,
    categories: categories.filter(category => !category.parent_id),
    subCategories: categories.filter(category => category.parent_id),
  }
}

/** GET /api/products/admin/company/:companyId/taxonomy — owner-scoped edit options */
async function getCompanyTaxonomy(req, res) {
  const companyId = req.params.companyId
  const companyExists = await Company.exists({ _id: companyId })
  if (!companyExists) return sendError(res, 'Product owner company not found.', 404)
  sendSuccess(res, await loadTaxonomy(companyId))
}

/** GET /api/products/admin/product/:productId/taxonomy — legacy orphan edit options */
async function getProductTaxonomy(req, res) {
  const product = await Product.findOne({
    _id: req.params.productId,
    status: { $ne: 'deleted' },
  }).select('company_id').lean()
  if (!product?.company_id) return sendError(res, 'Product owner could not be resolved.', 404)
  sendSuccess(res, await loadTaxonomy(product.company_id))
}

/** GET /api/products/search */
async function searchProducts(req, res) {
  const { q, finish, material, color, size, min_price, max_price, page = 1, limit = 20 } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)

  const query = { company_id: req.user.company_id, is_active: true, status: { $ne: 'deleted' } }
  if (q)         query.$or = [{ name: { $regex: q, $options: 'i' } }, { code: { $regex: q, $options: 'i' } }]
  if (finish)    query.finish   = finish
  if (material)  query.material = material
  if (color)     query.color    = { $regex: color, $options: 'i' }
  if (size)      query.size     = { $regex: size,  $options: 'i' }
  if (min_price) query.selling_price = { ...query.selling_price, $gte: parseFloat(min_price) }
  if (max_price) query.selling_price = { ...query.selling_price, $lte: parseFloat(max_price) }

  const [total, products] = await Promise.all([
    Product.countDocuments(query),
    Product.find(query)
      .populate('brand_id', 'name')
      .populate('category_id', 'name')
      .populate('sub_category_id', 'name')
      .sort({ name: 1 })
      .skip(offset)
      .limit(parseInt(limit))
      .lean(),
  ])

  sendSuccess(res, { products, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

/** GET /api/products/recycle-bin */
async function getRecycleBin(req, res) {
  const { search } = req.query
  const query = productScope(req, { status: 'deleted' })
  if (search) query.$or = [{ name: { $regex: search, $options: 'i' } }, { code: { $regex: search, $options: 'i' } }]

  const products = await Product.find(query)
    .populate('company_id', 'company_code name biz_type status is_active')
    .populate('created_by', 'name role')
    .populate('brand_id', 'name')
    .populate('category_id', 'name')
    .populate('sub_category_id', 'name')
    .sort({ deleted_at: -1 })
    .lean()
  sendSuccess(res, products)
}

/** GET /api/products/:id */
async function getProduct(req, res) {
  const product = await Product.findOne(productScope(req, { _id: req.params.id }))
    .populate('company_id', 'company_code name biz_type status is_active')
    .populate('created_by', 'name role')
    .populate('brand_id', 'name')
    .populate('category_id', 'name')
    .populate('sub_category_id', 'name')
    .lean()
  if (!product) return sendError(res, 'Product not found.', 404)

  // Attach per-warehouse inventory breakdown
  const inventoryRecords = await Inventory.find({ product_id: product._id })
    .populate('warehouse_id', 'name city')
    .lean()
  const totalStock = inventoryRecords.reduce((acc, inv) => {
    acc.available_stock += inv.available_stock || 0
    acc.physical_stock  += inv.physical_stock  || 0
    acc.reserved_stock  += inv.reserved_stock  || 0
    acc.current_stock   += inv.current_stock   || 0
    return acc
  }, { available_stock: 0, physical_stock: 0, reserved_stock: 0, current_stock: 0 })

  sendSuccess(res, { ...product, ...totalStock, inventory: inventoryRecords })
}

/** POST /api/products */
async function createProduct(req, res) {
  const rawBody = { ...(req.body || {}) }
  const rawOpeningStock = rawBody.opening_stock
  const requestedWarehouseId = rawBody.warehouse_id
  const openingStock = rawOpeningStock === '' || rawOpeningStock == null
    ? 0
    : Number(rawOpeningStock)

  if (!Number.isFinite(openingStock) || openingStock < 0) {
    return sendError(res, 'Opening stock must be a non-negative number.')
  }

  let openingWarehouse = null
  if (openingStock > 0) {
    if (!requestedWarehouseId) {
      return sendError(res, 'Select a warehouse when opening stock is greater than zero.')
    }
    if (!mongoose.isValidObjectId(requestedWarehouseId)) {
      return sendError(res, 'Selected warehouse is invalid.')
    }
    openingWarehouse = await Warehouse.findOne({
      _id: requestedWarehouseId,
      company_id: req.user.company_id,
      is_active: true,
    }).select('_id').lean()
    if (!openingWarehouse) {
      return sendError(res, 'Selected warehouse was not found, is inactive, or belongs to another company.', 404)
    }
  }

  const forbiddenFields = [
    '_id', 'company_id', 'created_by', 'created_by_type',
    'status', 'deleted_at', 'deleted_by', 'deleted_was_active', 'created_at', 'updated_at',
    'opening_stock', 'warehouse_id', 'stock_in', 'stock_out', 'current_stock', 'low_stock_alert',
    'image_urls',
  ]
  forbiddenFields.forEach(field => delete rawBody[field])

  let body = nullifyIds(rawBody)
  const { name, category_id, sub_category_id, brand_id } = body
  if (!name) return sendError(res, 'Product name is required.')

  // Auto-generate code if not provided
  let { code } = body
  if (!code?.trim()) {
    code = `PRD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`
    body.code = code
  }

  const existing = await Product.findOne({ code: code.trim(), company_id: req.user.company_id, status: { $ne: 'deleted' } }).lean()
  if (existing) return sendError(res, `Product with code "${code}" already exists.`, 409)

  if (category_id) {
    const cat = await Category.findOne({ _id: category_id, company_id: req.user.company_id }).lean()
    if (!cat)          return sendError(res, 'Selected category not found.', 404)
    if (!cat.is_active) return sendError(res, 'Selected category is inactive.', 400)
  }

  if (sub_category_id) {
    const sub = await Category.findOne({ _id: sub_category_id, company_id: req.user.company_id }).lean()
    if (!sub)           return sendError(res, 'Selected sub-category not found.', 404)
    if (!sub.is_active)  return sendError(res, 'Selected sub-category is inactive.', 400)
    if (!sub.parent_id)  return sendError(res, 'Selected sub-category is invalid.', 400)
    if (category_id && sub.parent_id.toString() !== category_id.toString())
      return sendError(res, 'Sub-category does not belong to the selected category.', 400)
  }

  if (brand_id) {
    const br = await Brand.findOne({ _id: brand_id, company_id: req.user.company_id }).lean()
    if (!br)          return sendError(res, 'Selected brand not found.', 404)
    if (!br.is_active) return sendError(res, 'Selected brand is inactive.', 400)
  }

  const image_urls = (req.files || []).map(f => `/uploads/images/${f.filename}`)
  const createdByType = await getCreatorType(req)
  const productData = {
    ...normaliseBody(body),
    company_id: req.user.company_id,
    created_by: req.user._id || req.user.id,
    created_by_type: createdByType,
    category_id, sub_category_id, brand_id,
    image_urls,
    status: 'active',
  }

  // Always create an Inventory record, even when opening_stock = 0.
  // A zero-stock stub means the product appears in Inventory Management
  // from day one and can receive stock via purchases or adjustments.
  const inventoryData = (product, warehouseId) => ({
    company_id:      req.user.company_id,
    product_id:      product._id,
    warehouse_id:    warehouseId || null,
    physical_stock:  openingStock,
    available_stock: openingStock,
    stock_in:        openingStock,
    stock_out:       0,
    current_stock:   openingStock,
    low_stock_alert: product.min_stock_level || 0,
    reorder_level:   product.reorder_level   || 0,
    purchase_rate:   product.purchase_price  || 0,
  })

  // Resolve the default warehouse for zero-stock products — use any active warehouse
  // belonging to this company so the record has a home from the start.
  let defaultWarehouseId = openingWarehouse?._id || null
  if (!defaultWarehouseId) {
    const anyWarehouse = await Warehouse.findOne({
      company_id: req.user.company_id,
      is_active:  true,
    }).select('_id').lean().catch(() => null)
    defaultWarehouseId = anyWarehouse?._id || null
  }

  let product
  let openingInventory = null

  const session = await mongoose.startSession()
  try {
    await session.withTransaction(async () => {
      ;[product] = await Product.create([productData], { session })
      // Always create an Inventory stub — zero stock is fine, shows in inventory page
      ;[openingInventory] = await Inventory.create([inventoryData(product, defaultWarehouseId)], { session })
    })
  } catch (error) {
    const transactionUnsupported = error?.code === 20 ||
      error?.codeName === 'IllegalOperation' ||
      /transaction numbers are only allowed|transactions are not supported/i.test(error?.message || '')
    if (!transactionUnsupported) throw error

    // Standalone MongoDB — run writes sequentially without a session
    product = await Product.create(productData)
    try {
      openingInventory = await Inventory.create(inventoryData(product, defaultWarehouseId))
    } catch (inventoryError) {
      // Inventory stub creation is non-fatal — log but don't roll back the product
      console.warn(`[createProduct] Inventory stub creation failed for ${product._id}:`, inventoryError.message)
      openingInventory = null
    }
  } finally {
    await session.endSession()
  }

  const responseProduct = product.toObject ? product.toObject() : product
  sendSuccess(res, {
    ...responseProduct,
    ...(openingInventory && {
      opening_inventory: openingInventory.toObject ? openingInventory.toObject() : openingInventory,
    }),
  }, openingInventory ? 'Product created with opening stock.' : 'Product created.', 201)
}

/** PUT /api/products/:id */
async function updateProduct(req, res) {
  const rawBody = req.body || {}
  const body = nullifyIds(rawBody)
  const { category_id, sub_category_id, brand_id } = body
  const wasSubmitted = field => Object.prototype.hasOwnProperty.call(rawBody, field)
  const categorySubmitted = wasSubmitted('category_id')
  const subCategorySubmitted = wasSubmitted('sub_category_id')
  const brandSubmitted = wasSubmitted('brand_id')

  const target = await Product.findOne(productScope(req, {
    _id: req.params.id,
    status: { $ne: 'deleted' },
  })).select('company_id image_urls category_id sub_category_id').lean()
  if (!target) return sendError(res, 'Product not found.', 404)

  const ownerCompanyId = target.company_id
  const effectiveCategoryId = categorySubmitted ? category_id : target.category_id
  let effectiveSubCategoryId = subCategorySubmitted ? sub_category_id : target.sub_category_id
  let clearRetainedSubCategory = false

  if (categorySubmitted && !subCategorySubmitted) {
    const categoryChanged = String(category_id || '') !== String(target.category_id || '')
    if (categoryChanged) {
      effectiveSubCategoryId = null
      clearRetainedSubCategory = true
    }
  }

  if (effectiveCategoryId) {
    const category = await Category.findOne({ _id: effectiveCategoryId, company_id: ownerCompanyId }).lean()
    if (!category) return sendError(res, 'Selected category does not belong to the product owner company.', 404)
    if (!category.is_active) return sendError(res, 'Selected category is inactive.', 400)
    if (category.parent_id) return sendError(res, 'Selected category must be a top-level category.', 400)
  }

  if (effectiveSubCategoryId) {
    if (!effectiveCategoryId) return sendError(res, 'Select a category before selecting a sub-category.', 400)
    const subCategory = await Category.findOne({ _id: effectiveSubCategoryId, company_id: ownerCompanyId }).lean()
    if (!subCategory) return sendError(res, 'Selected sub-category does not belong to the product owner company.', 404)
    if (!subCategory.is_active) return sendError(res, 'Selected sub-category is inactive.', 400)
    if (!subCategory.parent_id) return sendError(res, 'Selected sub-category is invalid.', 400)
    if (subCategory.parent_id.toString() !== effectiveCategoryId.toString())
      return sendError(res, 'Sub-category does not belong to the selected category.', 400)
  }

  if (brandSubmitted && brand_id) {
    const brand = await Brand.findOne({ _id: brand_id, company_id: ownerCompanyId }).lean()
    if (!brand) return sendError(res, 'Selected brand does not belong to the product owner company.', 404)
    if (!brand.is_active) return sendError(res, 'Selected brand is inactive.', 400)
  }

  const newlyUploaded = (req.files || []).map(f => `/uploads/images/${f.filename}`)
  let image_urls
  if (body.image_urls !== undefined || newlyUploaded.length > 0) {
    const currentImages = new Set((target.image_urls || []).map(String))
    let kept = [...currentImages]
    if (body.image_urls !== undefined) {
      try {
        const requested = typeof body.image_urls === 'string'
          ? JSON.parse(body.image_urls)
          : (Array.isArray(body.image_urls) ? body.image_urls : [])
        kept = Array.isArray(requested)
          ? requested.map(String).filter(url => currentImages.has(url))
          : []
      } catch { kept = [] }
    }
    image_urls = [...kept, ...newlyUploaded]
  }

  const normalizedBody = normaliseBody(body)
  Object.keys(normalizedBody).forEach(field => {
    if (!wasSubmitted(field)) delete normalizedBody[field]
  })
  const forbiddenFields = [
    '_id', 'company_id', 'created_by', 'created_by_type',
    'status', 'deleted_at', 'deleted_by', 'deleted_was_active', 'created_at', 'updated_at',
  ]
  forbiddenFields.forEach(field => delete normalizedBody[field])
  const { image_urls: _ignored, category_id: _category, sub_category_id: _subCategory, brand_id: _brand, ...rest } = normalizedBody
  const updateData = { ...rest }
  if (categorySubmitted) updateData.category_id = category_id
  if (subCategorySubmitted) updateData.sub_category_id = sub_category_id
  else if (clearRetainedSubCategory) updateData.sub_category_id = null
  if (brandSubmitted) updateData.brand_id = brand_id
  if (image_urls !== undefined) updateData.image_urls = image_urls

  const product = await Product.findOneAndUpdate(
    { _id: req.params.id, company_id: ownerCompanyId, status: { $ne: 'deleted' } },
    updateData,
    { new: true }
  )
    .populate('company_id', 'company_code name biz_type status is_active')
    .populate('created_by', 'name role')
    .populate('brand_id', 'name')
    .populate('category_id', 'name')
    .populate('sub_category_id', 'name')
    .lean()
  if (!product) return sendError(res, 'Product not found.', 404)
  sendSuccess(res, product, 'Product updated.')
}

/** DELETE /api/products/:id  — soft delete */
async function deleteProduct(req, res) {
  const target = await Product.findOne(productScope(req, {
    _id: req.params.id,
    status: { $ne: 'deleted' },
  })).select('company_id is_active').lean()
  if (!target) return sendError(res, 'Product not found.', 404)

  const product = await Product.findOneAndUpdate(
    { _id: req.params.id, company_id: target.company_id, status: { $ne: 'deleted' } },
    {
      status: 'deleted',
      is_active: false,
      deleted_was_active: target.is_active !== false,
      deleted_at: new Date(),
      deleted_by: req.user._id || req.user.id,
    },
    { new: true }
  ).lean()
  if (!product) return sendError(res, 'Product not found.', 404)
  sendSuccess(res, null, 'Product moved to Recycle Bin.')
}

/** POST /api/products/:id/restore */
async function restoreProduct(req, res) {
  const target = await Product.findOne(productScope(req, {
    _id: req.params.id,
    status: 'deleted',
  })).select('company_id deleted_was_active').lean()
  if (!target) return sendError(res, 'Product not found in Recycle Bin.', 404)

  const restoredActiveState = typeof target.deleted_was_active === 'boolean'
    ? target.deleted_was_active
    : true
  const product = await Product.findOneAndUpdate(
    { _id: req.params.id, company_id: target.company_id, status: 'deleted' },
    {
      status: 'active',
      is_active: restoredActiveState,
      deleted_at: null,
      deleted_by: null,
      deleted_was_active: null,
    },
    { new: true }
  )
    .populate('company_id', 'company_code name biz_type status is_active')
    .populate('created_by', 'name role')
    .lean()
  if (!product) return sendError(res, 'Product not found in Recycle Bin.', 404)
  sendSuccess(res, product, 'Product restored successfully.')
}

/** GET /api/products/:id/check-transactions */
async function checkProductTransactions(req, res) {
  const product = await Product.findOne(productScope(req, { _id: req.params.id }))
    .select('company_id')
    .lean()
  if (!product) return sendError(res, 'Product not found.', 404)

  const pid = new mongoose.Types.ObjectId(req.params.id)
  const cid = new mongoose.Types.ObjectId(product.company_id.toString())

  let hasTransactions = false
  try {
    const checks = await Promise.allSettled([
      mongoose.connection.db.collection('orders').countDocuments({ company_id: cid, product_id: pid }),
      mongoose.connection.db.collection('purchases').countDocuments({ company_id: cid, product_id: pid }),
      mongoose.connection.db.collection('enquiries').countDocuments({ company_id: cid, product_id: pid }),
      mongoose.connection.db.collection('sales').countDocuments({ company_id: cid, product_id: pid }),
      mongoose.connection.db.collection('inventories').countDocuments({ company_id: cid, product_id: pid }),
    ])
    hasTransactions = checks.some(result => result.status === 'fulfilled' && result.value > 0)
  } catch { hasTransactions = false }

  sendSuccess(res, { hasTransactions })
}

/**
 * GET /api/products/for-select
 * Lightweight product list for dropdowns (quotation / invoice item selection).
 * Only requires authenticate — no moduleAccess guard.
 * Super Admin gets all products across all companies.
 * Company users get their own company's products.
 */
async function productsForSelect(req, res) {
  try {
    const limit  = Math.min(parseInt(req.query.limit, 10) || 500, 1000)
    const search = String(req.query.search || '').trim()
    const isSuperAdmin = req.user?.role === 'Super Admin'

    const query = { status: { $ne: 'deleted' } }
    // Scope to company unless Super Admin
    if (!isSuperAdmin) {
      if (!req.user?.company_id) return sendSuccess(res, { products: [] })
      query.company_id = req.user.company_id
    }
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i')
      query.$or = [{ name: rx }, { code: rx }]
    }

    const products = await Product.find(query)
      .select('name code unit gst_percent mrp retail_price dealer_price purchase_price pcs_per_box sqft_per_box brand_name category_name sub_category_name size finish tile_type grade color hsn_code image_urls is_active company_id')
      .populate('brand_id',        'name')
      .populate('category_id',     'name')
      .populate('sub_category_id', 'name')
      .sort({ name: 1 })
      .limit(limit)
      .lean()

    const shaped = products.map(p => ({
      ...p,
      brand_name:        p.brand_name        || p.brand_id?.name        || '',
      category_name:     p.category_name     || p.category_id?.name     || '',
      sub_category_name: p.sub_category_name || p.sub_category_id?.name || '',
    }))

    sendSuccess(res, { products: shaped })
  } catch (err) {
    sendError(res, err.message || 'Failed to fetch products', 500)
  }
}

module.exports = {
  productsForSelect,
  listProducts, listAllProducts, getCompanyTaxonomy, getProductTaxonomy, getProduct, createProduct, updateProduct, deleteProduct,
  searchProducts, getRecycleBin, restoreProduct, checkProductTransactions,
}
