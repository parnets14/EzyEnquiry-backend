/**
 * Wholesaler Product Catalog Controller
 *
 * Wholesaler ONLY views admin products — no create / edit / delete.
 * Stock is managed separately via Purchase → Inventory.
 *
 * Endpoints (all require authenticate):
 *   GET /api/wholesaler/products/filters  — distinct filter values
 *   GET /api/wholesaler/products          — catalog list
 *   GET /api/wholesaler/products/:id      — single product detail
 */

const Product = require('../../models/Product Management/Product')
const { sendSuccess, sendError, paginate } = require('../../utils/helpers')

// Generate a unique product code for this company (PRD-0001 style).
async function nextProductCode(companyId) {
  const last = await Product.findOne({ company_id: companyId, code: /^PRD-/ })
    .sort({ code: -1 }).lean()
  const num = last?.code ? parseInt(last.code.split('-')[1], 10) : 0
  return `PRD-${String(num + 1).padStart(4, '0')}`
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/wholesaler/products
// Wholesaler creates their OWN product (scoped to their company_id).
// Supports tiles (pcs_per_box / sqft_per_box) and granite (per-sqft) pricing.
// ─────────────────────────────────────────────────────────────────────────────
async function createProduct(req, res) {
  const companyId = req.user.company_id
  if (!companyId) return sendError(res, 'No company linked to your account.', 400)

  const b = req.body
  if (!b.name || !String(b.name).trim()) return sendError(res, 'Product name is required.')

  const code = (b.code && String(b.code).trim()) || await nextProductCode(companyId)

  // Prevent duplicate code within the company
  const dup = await Product.findOne({ company_id: companyId, code }).lean()
  if (dup) return sendError(res, `Product code "${code}" already exists.`, 409)

  const num = (v, d = 0) => (v === '' || v == null ? d : parseFloat(v))

  const product = await Product.create({
    company_id:     companyId,
    code,
    name:           String(b.name).trim(),
    alias:          b.alias || '',
    brand_id:       b.brand_id || null,
    category_id:    b.category_id || null,
    sub_category_id: b.sub_category_id || null,

    hsn_code:  b.hsn_code || '',
    size:      b.size || '',
    finish:    b.finish || '',
    material:  b.material || '',
    color:     b.color || '',
    surface:   b.surface || '',
    thickness: b.thickness || '',
    grade:     b.grade || '',
    tile_type: b.tile_type || '',
    application: b.application || '',
    origin:    b.origin || '',
    manufacturer: b.manufacturer || '',

    // Packing / coverage (tiles)
    design:         b.design || '',
    collection:     b.collection || '',
    pcs_per_box:    b.pcs_per_box    != null && b.pcs_per_box    !== '' ? num(b.pcs_per_box)    : null,
    sqft_per_box:   b.sqft_per_box   != null && b.sqft_per_box   !== '' ? num(b.sqft_per_box)   : null,
    weight_per_box: b.weight_per_box != null && b.weight_per_box !== '' ? num(b.weight_per_box) : null,

    // Unit & tax
    unit:        b.unit || 'Sq Ft',
    gst_percent: num(b.gst_percent, 18),
    description: b.description || '',

    // Pricing
    purchase_price: num(b.purchase_price),
    selling_price:  num(b.selling_price),
    dealer_price:   num(b.dealer_price),
    retail_price:   num(b.retail_price),
    wholesale_rate: num(b.wholesale_rate),
    mrp:            num(b.mrp),

    product_type: b.product_type || 'Regular Product',
    image_urls:   Array.isArray(b.image_urls) ? b.image_urls : [],
    is_active:    true,
    status:       'active',
  })

  sendSuccess(res, product, 'Product created.', 201)
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/wholesaler/products/filters
// Distinct values for filter dropdowns (size, finish, material, color)
// ─────────────────────────────────────────────────────────────────────────────
async function getFilters(req, res) {
  const base = { is_active: true, status: { $ne: 'deleted' } }

  const [sizes, finishes, materials, colors] = await Promise.all([
    Product.distinct('size',     { ...base, size:     { $nin: ['', null] } }),
    Product.distinct('finish',   { ...base, finish:   { $nin: ['', null] } }),
    Product.distinct('material', { ...base, material: { $nin: ['', null] } }),
    Product.distinct('color',    { ...base, color:    { $nin: ['', null] } }),
  ])

  sendSuccess(res, {
    sizes:     sizes.filter(Boolean).sort(),
    finishes:  finishes.filter(Boolean).sort(),
    materials: materials.filter(Boolean).sort(),
    colors:    colors.filter(Boolean).sort(),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/wholesaler/products
// All active products from all companies (admin products)
// Query params: page, limit, search, size, finish, material, color, category, brand
// ─────────────────────────────────────────────────────────────────────────────
async function listCatalog(req, res) {
  const {
    page = 1, limit = 20,
    search, size, finish, material, color, category, brand,
  } = req.query

  const offset = (parseInt(page) - 1) * parseInt(limit)

  // All active products — no company_id filter (admin products visible to all)
  const query = { is_active: true, status: { $ne: 'deleted' } }

  if (search) {
    query.$or = [
      { name:   { $regex: search, $options: 'i' } },
      { code:   { $regex: search, $options: 'i' } },
      { design: { $regex: search, $options: 'i' } },
      { alias:  { $regex: search, $options: 'i' } },
    ]
  }
  if (size)     query.size     = { $regex: size,     $options: 'i' }
  if (finish)   query.finish   = { $regex: finish,   $options: 'i' }
  if (material) query.material = { $regex: material, $options: 'i' }
  if (color)    query.color    = { $regex: color,    $options: 'i' }

  const mongoose = require('mongoose')
  if (category && mongoose.Types.ObjectId.isValid(category)) {
    query.category_id = category
  }
  if (brand && mongoose.Types.ObjectId.isValid(brand)) {
    query.brand_id = brand
  }

  const [total, products] = await Promise.all([
    Product.countDocuments(query),
    Product.find(query)
      .populate('brand_id',        'name')
      .populate('category_id',     'name')
      .populate('sub_category_id', 'name')
      .sort({ name: 1 })
      .skip(offset)
      .limit(parseInt(limit))
      .lean(),
  ])

  sendSuccess(res, {
    products,
    pagination: paginate(total, parseInt(page), parseInt(limit)),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/wholesaler/products/:id
// Single product detail — read only
// ─────────────────────────────────────────────────────────────────────────────
async function getCatalogProduct(req, res) {
  const product = await Product.findOne({
    _id:       req.params.id,
    is_active: true,
    status:    { $ne: 'deleted' },
  })
    .populate('brand_id',        'name')
    .populate('category_id',     'name')
    .populate('sub_category_id', 'name')
    .lean()

  if (!product) return sendError(res, 'Product not found.', 404)
  sendSuccess(res, product)
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/wholesaler/products/mine  — products created by this wholesaler's company
// ─────────────────────────────────────────────────────────────────────────────
async function listMyProducts(req, res) {
  const { page = 1, limit = 20, search } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)
  const query = { company_id: req.user.company_id, status: { $ne: 'deleted' } }
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { code: { $regex: search, $options: 'i' } },
    ]
  }
  const [total, products] = await Promise.all([
    Product.countDocuments(query),
    Product.find(query).sort({ created_at: -1 }).skip(offset).limit(parseInt(limit)).lean(),
  ])
  sendSuccess(res, { products, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/wholesaler/products/:id
// Soft-delete — ONLY the wholesaler's own product (company_id must match).
// ─────────────────────────────────────────────────────────────────────────────
async function deleteProduct(req, res) {
  const product = await Product.findById(req.params.id).lean()
  if (!product) return sendError(res, 'Product not found.', 404)

  // Can only delete your OWN products
  if (String(product.company_id) !== String(req.user.company_id)) {
    return sendError(res, 'You can only delete products you created.', 403)
  }

  await Product.findByIdAndUpdate(req.params.id, {
    status:     'deleted',
    is_active:  false,
    deleted_at: new Date(),
    deleted_by: req.user._id,
  })

  sendSuccess(res, { deleted: true }, 'Product deleted.')
}

module.exports = { listCatalog, getCatalogProduct, getFilters, createProduct, listMyProducts, deleteProduct }
