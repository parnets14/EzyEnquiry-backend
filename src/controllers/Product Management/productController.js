const { sendSuccess, sendError, paginate } = require('../../utils/helpers')
const Product          = require('../../models/Product Management/Product')
const Category         = require('../../models/Product Management/Category')
const Brand            = require('../../models/Product Management/Brand')
const resolveCompanyId = require('../../utils/resolveCompany')
const mongoose         = require('mongoose')

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
  }
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
  const { page = 1, limit = 20, search, finish, material, sub_category, is_active } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)

  const query = { company_id: req.user.company_id, status: { $ne: 'deleted' } }
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

  sendSuccess(res, { products, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

/** GET /api/products/search */
async function searchProducts(req, res) {
  const { q, finish, material, color, size, min_price, max_price, page = 1, limit = 20 } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)

  const query = { is_active: true, status: { $ne: 'deleted' } }
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
  const query = { company_id: req.user.company_id, status: 'deleted' }
  if (search) query.$or = [{ name: { $regex: search, $options: 'i' } }, { code: { $regex: search, $options: 'i' } }]

  const products = await Product.find(query)
    .populate('brand_id', 'name')
    .populate('category_id', 'name')
    .populate('sub_category_id', 'name')
    .sort({ deleted_at: -1 })
    .lean()
  sendSuccess(res, products)
}

/** GET /api/products/:id */
async function getProduct(req, res) {
  const product = await Product.findOne({ _id: req.params.id, company_id: req.user.company_id })
    .populate('brand_id', 'name')
    .populate('category_id', 'name')
    .populate('sub_category_id', 'name')
    .lean()
  if (!product) return sendError(res, 'Product not found.', 404)
  sendSuccess(res, product)
}

/** POST /api/products */
async function createProduct(req, res) {
  let body = nullifyIds(req.body)
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
  const product = await Product.create({
    ...normaliseBody(body),
    company_id: req.user.company_id,
    category_id, sub_category_id, brand_id,
    image_urls,
    status: 'active',
  })
  sendSuccess(res, product, 'Product created.', 201)
}

/** PUT /api/products/:id */
async function updateProduct(req, res) {
  const body = nullifyIds(req.body)
  const { category_id, sub_category_id, brand_id } = body

  if (category_id) {
    const cat = await Category.findOne({ _id: category_id, company_id: req.user.company_id }).lean()
    if (!cat) return sendError(res, 'Selected category not found.', 404)
  }

  if (sub_category_id) {
    const sub = await Category.findOne({ _id: sub_category_id, company_id: req.user.company_id }).lean()
    if (!sub)           return sendError(res, 'Selected sub-category not found.', 404)
    if (!sub.is_active)  return sendError(res, 'Selected sub-category is inactive.', 400)
    if (!sub.parent_id)  return sendError(res, 'Selected sub-category is invalid.', 400)
    if (category_id && sub.parent_id.toString() !== category_id.toString())
      return sendError(res, 'Sub-category does not belong to the selected category.', 400)
  }

  // Merge kept images with newly uploaded images
  const newlyUploaded = (req.files || []).map(f => `/uploads/images/${f.filename}`)
  let image_urls
  if (body.image_urls !== undefined || newlyUploaded.length > 0) {
    let kept = []
    if (body.image_urls !== undefined) {
      try { kept = typeof body.image_urls === 'string' ? JSON.parse(body.image_urls) : (Array.isArray(body.image_urls) ? body.image_urls : []) }
      catch { kept = [] }
    } else {
      const current = await Product.findOne({ _id: req.params.id, company_id: req.user.company_id }).select('image_urls').lean()
      kept = current?.image_urls || []
    }
    image_urls = [...kept, ...newlyUploaded]
  }

  const { image_urls: _ignored, ...rest } = normaliseBody(body)
  const updateData = { ...rest, category_id, sub_category_id, brand_id }
  if (image_urls !== undefined) updateData.image_urls = image_urls
  // Strip undefined values
  Object.keys(updateData).forEach(k => updateData[k] === undefined && delete updateData[k])

  const product = await Product.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id, status: { $ne: 'deleted' } },
    updateData,
    { new: true }
  ).lean()
  if (!product) return sendError(res, 'Product not found.', 404)
  sendSuccess(res, product, 'Product updated.')
}

/** DELETE /api/products/:id  — soft delete */
async function deleteProduct(req, res) {
  const product = await Product.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id, status: { $ne: 'deleted' } },
    { status: 'deleted', deleted_at: new Date(), deleted_by: req.user._id || req.user.id },
    { new: true }
  ).lean()
  if (!product) return sendError(res, 'Product not found.', 404)
  sendSuccess(res, null, 'Product moved to Recycle Bin.')
}

/** POST /api/products/:id/restore */
async function restoreProduct(req, res) {
  const product = await Product.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id, status: 'deleted' },
    { status: 'active', deleted_at: null, deleted_by: null },
    { new: true }
  ).lean()
  if (!product) return sendError(res, 'Product not found in Recycle Bin.', 404)
  sendSuccess(res, product, 'Product restored successfully.')
}

/** GET /api/products/:id/check-transactions */
async function checkProductTransactions(req, res) {
  const pid = new mongoose.Types.ObjectId(req.params.id)
  const cid = new mongoose.Types.ObjectId(req.user.company_id.toString())

  let hasTransactions = false
  try {
    const checks = await Promise.allSettled([
      mongoose.connection.db.collection('orders').countDocuments({ company_id: cid, product_id: pid }),
      mongoose.connection.db.collection('purchases').countDocuments({ company_id: cid, product_id: pid }),
      mongoose.connection.db.collection('enquiries').countDocuments({ company_id: cid, product_id: pid }),
      mongoose.connection.db.collection('sales').countDocuments({ company_id: cid, product_id: pid }),
      mongoose.connection.db.collection('inventories').countDocuments({ company_id: cid, product_id: pid }),
    ])
    hasTransactions = checks.some(r => r.status === 'fulfilled' && r.value > 0)
  } catch { hasTransactions = false }

  sendSuccess(res, { hasTransactions })
}

module.exports = {
  listProducts, getProduct, createProduct, updateProduct, deleteProduct,
  searchProducts, getRecycleBin, restoreProduct, checkProductTransactions,
}
