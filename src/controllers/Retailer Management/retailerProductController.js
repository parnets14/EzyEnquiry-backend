const Product = require('../../models/Product Management/Product')
const Brand = require('../../models/Product Management/Brand')
const Category = require('../../models/Product Management/Category')

// ─── Helpers ──────────────────────────────────────────────────────────────────
function ok(res, data, message = 'Success', statusCode = 200, pagination = null) {
  const body = { success: true, message, data }
  if (pagination) body.pagination = pagination
  return res.status(statusCode).json(body)
}

function sendError(res, message, statusCode = 400) {
  return res.status(statusCode).json({ success: false, message })
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function num(value) {
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function money(value) {
  const n = Number(value || 0)
  return Number.isFinite(n) && n > 0 ? Math.round((n + Number.EPSILON) * 100) / 100 : 0
}

function bool(value) {
  return value === true || value === 'true' || value === '1' || value === 1
}

function str(value) {
  return typeof value === 'string' ? value.trim() : (value != null ? String(value).trim() : '')
}

// Find-or-create a Brand by name under the retailer's company.
async function resolveBrand(name, companyId) {
  const clean = str(name)
  if (!clean) return null
  const existing = await Brand.findOne({ company_id: companyId, name: new RegExp(`^${escapeRegex(clean)}$`, 'i') }).lean()
  if (existing) return existing._id
  const created = await Brand.create({ company_id: companyId, name: clean, is_active: true })
  return created._id
}

// Find-or-create a Category (or sub-category when parentId is provided).
async function resolveCategory(name, companyId, parentId = null) {
  const clean = str(name)
  if (!clean) return null
  const query = { company_id: companyId, name: new RegExp(`^${escapeRegex(clean)}$`, 'i') }
  if (parentId) query.parent_id = parentId
  else query.parent_id = null
  const existing = await Category.findOne(query).lean()
  if (existing) return existing._id
  const created = await Category.create({ company_id: companyId, name: clean, parent_id: parentId, is_active: true })
  return created._id
}

function productResponse(product) {
  return {
    id: product._id,
    code: product.code,
    name: product.name,
    alias: product.alias || '',
    brand: product.brand_id ? { id: product.brand_id._id || product.brand_id, name: product.brand_id.name || '' } : null,
    category: product.category_id ? { id: product.category_id._id || product.category_id, name: product.category_id.name || '' } : null,
    sub_category: product.sub_category_id ? { id: product.sub_category_id._id || product.sub_category_id, name: product.sub_category_id.name || '' } : null,
    specs: {
      hsn_code: product.hsn_code || '', size: product.size || '', finish: product.finish || '',
      material: product.material || '', color: product.color || '', surface: product.surface || '',
      thickness: product.thickness || '', grade: product.grade || '', tile_type: product.tile_type || '',
      application: product.application || '', anti_skid: product.anti_skid || '', origin: product.origin || '',
      manufacturer: product.manufacturer || '', barcode: product.barcode || '', design: product.design || '',
      collection: product.collection || '',
    },
    packing: {
      pcs_per_box: product.pcs_per_box, sqft_per_box: product.sqft_per_box, weight_per_box: product.weight_per_box,
    },
    unit: product.unit,
    gst_percent: product.gst_percent,
    description: product.description || '',
    prices: {
      mrp: product.mrp, retail_price: product.retail_price, dealer_price: product.dealer_price,
      wholesale_rate: product.wholesale_rate, project_rate: product.project_rate,
      purchase_price: product.purchase_price,
    },
    flags: {
      new_arrival: !!product.new_arrival, featured: !!product.featured,
      online_visible: product.online_visible !== false, dealer_visible: product.dealer_visible !== false,
    },
    image_urls: product.image_urls || [],
    status: product.status,
    created_at: product.created_at,
    updated_at: product.updated_at,
  }
}

// ─── Create a product owned by the retailer's own company ──────────────────────
async function createMyProduct(req, res) {
  const companyId = req.user.company_id
  const body = req.body || {}

  const name = str(body.name)
  if (!name) return sendError(res, 'Product name is required.')

  // Auto-generate code if not provided
  let code = str(body.code)
  if (!code) {
    code = `RPD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`
  }
  const duplicate = await Product.findOne({ code, company_id: companyId, status: { $ne: 'deleted' } }).lean()
  if (duplicate) return sendError(res, `A product with code "${code}" already exists.`, 409)

  // Brand / category / sub-category are provided by NAME (free text) and created if new.
  const brandId = await resolveBrand(body.brand_name || body.brand, companyId)
  const categoryId = await resolveCategory(body.category_name || body.category, companyId, null)
  const subCategoryId = categoryId
    ? await resolveCategory(body.sub_category_name || body.sub_category, companyId, categoryId)
    : null

  const imageUrls = (req.files || []).map(f => `/uploads/images/${f.filename}`)

  const product = await Product.create({
    company_id: companyId,
    code,
    name,
    alias: str(body.alias),
    brand_id: brandId,
    category_id: categoryId,
    sub_category_id: subCategoryId,

    hsn_code: str(body.hsn_code),
    size: str(body.size),
    finish: str(body.finish),
    material: str(body.material),
    color: str(body.color),
    surface: str(body.surface),
    thickness: str(body.thickness),
    grade: str(body.grade),
    tile_type: str(body.tile_type),
    application: str(body.application),
    anti_skid: str(body.anti_skid),
    origin: str(body.origin),
    manufacturer: str(body.manufacturer),
    barcode: str(body.barcode),

    design: str(body.design),
    collection: str(body.collection),
    pcs_per_box: num(body.pcs_per_box),
    sqft_per_box: num(body.sqft_per_box),
    weight_per_box: num(body.weight_per_box),

    unit: str(body.unit) || 'Box',
    gst_percent: num(body.gst_percent) ?? 18,
    description: str(body.description),

    purchase_price: money(body.purchase_rate || body.purchase_price),
    landing_cost: money(body.landing_cost),
    mrp: money(body.mrp),
    retail_price: money(body.retail_rate || body.retail_price),
    dealer_price: money(body.dealer_rate || body.dealer_price),
    wholesale_rate: money(body.wholesale_rate),
    project_rate: money(body.project_rate),
    min_selling_rate: money(body.min_selling_rate),
    min_stock_level: num(body.min_stock_level) ?? 0,
    reorder_level: num(body.reorder_level) ?? 0,

    sales_type: str(body.sales_type) || 'Regular Sale',
    product_type: str(body.product_type) || 'Regular Product',
    new_arrival: bool(body.new_arrival),
    featured: bool(body.featured),
    online_visible: body.online_visible === undefined ? true : bool(body.online_visible),
    dealer_visible: body.dealer_visible === undefined ? true : bool(body.dealer_visible),

    image_urls: imageUrls,
    is_active: true,
    status: 'active',
  })

  const populated = await Product.findById(product._id)
    .populate('brand_id', 'name')
    .populate('category_id', 'name')
    .populate('sub_category_id', 'name')
    .lean()

  return ok(res, productResponse(populated), 'Product created.', 201)
}

// ─── List the retailer's own products ──────────────────────────────────────────
async function listMyProducts(req, res) {
  const companyId = req.user.company_id
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1)
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100)
  const skip = (page - 1) * limit

  const query = { company_id: companyId, status: { $ne: 'deleted' } }
  const search = str(req.query.search)
  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i')
    query.$or = [{ code: regex }, { name: regex }, { alias: regex }, { design: regex }]
  }

  const [total, products] = await Promise.all([
    Product.countDocuments(query),
    Product.find(query)
      .populate('brand_id', 'name')
      .populate('category_id', 'name')
      .populate('sub_category_id', 'name')
      .sort({ created_at: -1 })
      .skip(skip).limit(limit).lean(),
  ])

  return ok(res, { products: products.map(productResponse) }, 'Products retrieved.', 200, {
    total, page, limit, pages: Math.ceil(total / limit) || 1,
  })
}

// ─── Get one of the retailer's own products ────────────────────────────────────
async function getMyProduct(req, res) {
  const product = await Product.findOne({ _id: req.params.id, company_id: req.user.company_id, status: { $ne: 'deleted' } })
    .populate('brand_id', 'name')
    .populate('category_id', 'name')
    .populate('sub_category_id', 'name')
    .lean()
  if (!product) return sendError(res, 'Product not found.', 404)
  return ok(res, productResponse(product), 'Product retrieved.')
}

// ─── Soft-delete the retailer's own product ────────────────────────────────────
async function deleteMyProduct(req, res) {
  const product = await Product.findOne({ _id: req.params.id, company_id: req.user.company_id, status: { $ne: 'deleted' } })
  if (!product) return sendError(res, 'Product not found.', 404)
  product.status = 'deleted'
  product.is_active = false
  product.deleted_at = new Date()
  product.deleted_by = req.user._id
  await product.save()
  return ok(res, { id: product._id }, 'Product deleted.')
}

module.exports = { createMyProduct, listMyProducts, getMyProduct, deleteMyProduct }
