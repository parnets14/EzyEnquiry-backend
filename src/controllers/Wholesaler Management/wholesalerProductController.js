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

module.exports = { listCatalog, getCatalogProduct, getFilters }
