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

const Product  = require('../../models/Product Management/Product')
const Category = require('../../models/Product Management/Category')
const Brand    = require('../../models/Product Management/Brand')
const Company  = require('../../models/Company Management/Company')
const { sendSuccess, sendError, paginate } = require('../../utils/helpers')

// Build a Mongo condition that limits which ADMIN products this company can see.
// Non-admin products (wholesaler/retailer listings) are always allowed.
// Admin products are shown only when shared_with_all OR the caller's
// company_code is in allowed_company_codes.
async function buildAccessClause(req) {
  let myCode = null
  if (req.user?.company_id) {
    const company = await Company.findById(req.user.company_id).select('company_code').lean()
    myCode = company?.company_code ? String(company.company_code).trim().toUpperCase() : null
  }

  // Admin products are hidden until access is explicitly granted:
  // shared_with_all: true (everyone) OR this company's code in allowed_company_codes.
  const adminAllowed = [{ shared_with_all: true }]
  if (myCode) adminAllowed.push({ allowed_company_codes: myCode })

  return {
    $or: [
      { created_by_type: { $ne: 'Admin' } }, // wholesaler/retailer listings unaffected
      { $and: [{ created_by_type: 'Admin' }, { $or: adminAllowed }] },
    ],
  }
}

// Generate a unique product code for this company (PRD-0001 style).
async function nextProductCode(companyId) {
  const last = await Product.findOne({ company_id: companyId, code: /^PRD-/ })
    .sort({ code: -1 }).lean()
  const num = last?.code ? parseInt(last.code.split('-')[1], 10) : 0
  return `PRD-${String(num + 1).padStart(4, '0')}`
}

const isRealObjectId = (v) => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v)

/**
 * Resolve a category id coming from the app into a real company Category _id.
 * The app may send a real ObjectId (own doc) OR a synthetic "master:<name>" id
 * (a global/existing category the wholesaler picked). For master picks — or when
 * only a name is available — find-or-create the company's own Category so the
 * product references a valid record.
 */
async function resolveCategoryId(companyId, id, name, parentId = null) {
  if (isRealObjectId(id)) return id
  const cleanName = String(name || (typeof id === 'string' && id.startsWith('master:') ? id.split(':').pop() : '')).trim()
  if (!cleanName) return null
  const q = { company_id: companyId, name: new RegExp(`^${cleanName}$`, 'i'), parent_id: parentId || null }
  let cat = await Category.findOne(q).lean()
  if (!cat) cat = await Category.create({ company_id: companyId, name: cleanName, parent_id: parentId || null })
  return cat._id
}

async function resolveBrandId(companyId, id, name) {
  if (isRealObjectId(id)) return id
  const cleanName = String(name || (typeof id === 'string' && id.startsWith('master:') ? id.split(':').pop() : '')).trim()
  if (!cleanName) return null
  let brand = await Brand.findOne({ company_id: companyId, name: new RegExp(`^${cleanName}$`, 'i') }).lean()
  if (!brand) brand = await Brand.create({ company_id: companyId, name: cleanName })
  return brand._id
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

  // Resolve category/sub-category/brand ids (handles "master:" picks + name-only).
  const categoryId    = await resolveCategoryId(companyId, b.category_id, b.category_name, null)
  const subCategoryId = await resolveCategoryId(companyId, b.sub_category_id, b.sub_category_name, categoryId)
  const brandId       = await resolveBrandId(companyId, b.brand_id, b.brand_name)

  const product = await Product.create({
    company_id:      companyId,
    created_by:      req.user._id || req.user.id,
    created_by_type: 'Wholesaler',
    code,
    name:           String(b.name).trim(),
    alias:          b.alias || '',
    brand_id:       brandId || null,
    category_id:    categoryId || null,
    sub_category_id: subCategoryId || null,
    brand_name:        b.brand_name || '',
    category_name:     b.category_name || '',
    sub_category_name: b.sub_category_name || '',

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

    // Category-specific dynamic fields
    attributes:    (b.attributes && typeof b.attributes === 'object') ? b.attributes : {},
    category_type: b.category_type || '',
    opening_stock: num(b.opening_stock),

    // Pricing
    purchase_price: num(b.purchase_price),
    selling_price:  num(b.selling_price),
    dealer_price:   num(b.dealer_price),
    retail_price:   num(b.retail_price),
    wholesale_rate: num(b.wholesale_rate),
    mrp:            num(b.mrp),

    product_type: b.product_type || 'Regular Product',
    source:       'wholesaler',   // tag: added from the wholesaler app
    image_urls:   Array.isArray(b.image_urls) ? b.image_urls : [],
    catalog_pdf_url: b.catalog_pdf_url || '',
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
    search, size, finish, material, color, category, brand, catalog_only,
  } = req.query

  const offset = (parseInt(page) - 1) * parseInt(limit)

  // All active products — no company_id filter (admin products visible to all)
  const query = { is_active: true, status: { $ne: 'deleted' } }
  // catalog_only=true → ONLY genuine Admin-created catalog products.
  // Note: source can be 'admin' for both Admin- and Retailer-created items, so
  // filtering on source alone leaks retailer products into the catalog. Gate on
  // created_by_type='Admin' (the authoritative creator field) instead.
  if (String(catalog_only) === 'true') query.created_by_type = 'Admin'
  // mine=true → only THIS wholesaler's own products (source=wholesaler + own company)
  if (String(req.query.mine) === 'true') {
    query.source = 'wholesaler'
    if (req.user.company_id) query.company_id = req.user.company_id
  }

  if (search) {
    query.$or = [
      { name:   { $regex: search, $options: 'i' } },
      { code:   { $regex: search, $options: 'i' } },
      { design: { $regex: search, $options: 'i' } },
      { alias:  { $regex: search, $options: 'i' } },
      { size:          { $regex: search, $options: 'i' } },
      { category_name: { $regex: search, $options: 'i' } },
      { brand_name:    { $regex: search, $options: 'i' } },
    ]
  }
  if (size)     query.size     = { $regex: size,     $options: 'i' }
  if (finish)   query.finish   = { $regex: finish,   $options: 'i' }
  if (material) query.material = { $regex: material, $options: 'i' }
  if (color)    query.color    = { $regex: color,    $options: 'i' }

  const mongoose = require('mongoose')
  // Category / brand filter: accept an ObjectId (per-company ref) OR a name string (global masters).
  if (category) {
    if (mongoose.Types.ObjectId.isValid(category)) query.category_id = category
    else query.category_name = { $regex: category, $options: 'i' }
  }
  if (brand) {
    if (mongoose.Types.ObjectId.isValid(brand)) query.brand_id = brand
    else query.brand_name = { $regex: brand, $options: 'i' }
  }

  // Per-company access control for admin products (skip for mine=true — own items).
  if (String(req.query.mine) !== 'true') {
    const accessClause = await buildAccessClause(req)
    query.$and = [...(query.$and || []), accessClause]
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

  // Disable client/proxy caching so tab switches (all / catalog_only / mine)
  // always return fresh, correctly-filtered data (avoids stale 304 responses).
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate')
  res.set('Pragma', 'no-cache')
  res.removeHeader && res.removeHeader('ETag')

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
  const accessClause = await buildAccessClause(req)
  const product = await Product.findOne({
    _id:       req.params.id,
    is_active: true,
    status:    { $ne: 'deleted' },
    ...accessClause,
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
// PUT /api/wholesaler/products/:id
// Update — ONLY the wholesaler's own product (company_id must match).
// ─────────────────────────────────────────────────────────────────────────────
async function updateProduct(req, res) {
  const existing = await Product.findById(req.params.id).lean()
  if (!existing) return sendError(res, 'Product not found.', 404)
  if (String(existing.company_id) !== String(req.user.company_id)) {
    return sendError(res, 'You can only edit products you created.', 403)
  }

  const b = req.body
  const num = (v, d) => (v === '' || v == null ? d : parseFloat(v))
  const update = {}

  // Text/spec fields — only set when provided
  const textFields = [
    'name', 'alias', 'hsn_code', 'size', 'finish', 'material', 'color', 'surface',
    'thickness', 'grade', 'tile_type', 'application', 'origin', 'manufacturer',
    'design', 'collection', 'unit', 'description', 'product_type', 'code',
    'brand_name', 'category_name', 'sub_category_name',
  ]
  textFields.forEach(f => { if (b[f] !== undefined) update[f] = b[f] })

  // Reference ids — resolve "master:" / name-only picks to real company records.
  if (b.category_id !== undefined || b.category_name !== undefined) {
    update.category_id = await resolveCategoryId(req.user.company_id, b.category_id, b.category_name, null)
  }
  if (b.sub_category_id !== undefined || b.sub_category_name !== undefined) {
    update.sub_category_id = await resolveCategoryId(req.user.company_id, b.sub_category_id, b.sub_category_name, update.category_id || existing.category_id || null)
  }
  if (b.brand_id !== undefined || b.brand_name !== undefined) {
    update.brand_id = await resolveBrandId(req.user.company_id, b.brand_id, b.brand_name)
  }

  // Numeric fields
  ;['pcs_per_box', 'sqft_per_box', 'weight_per_box', 'gst_percent',
    'purchase_price', 'selling_price', 'dealer_price', 'retail_price',
    'wholesale_rate', 'mrp'].forEach(f => {
    if (b[f] !== undefined) update[f] = num(b[f], existing[f] ?? 0)
  })

  if (Array.isArray(b.image_urls)) update.image_urls = b.image_urls
  if (b.catalog_pdf_url !== undefined) update.catalog_pdf_url = b.catalog_pdf_url

  // Category-specific dynamic fields
  if (b.attributes !== undefined && b.attributes && typeof b.attributes === 'object') update.attributes = b.attributes
  if (b.category_type !== undefined) update.category_type = b.category_type
  if (b.opening_stock !== undefined) update.opening_stock = num(b.opening_stock, existing.opening_stock ?? 0)

  // Lifecycle: active | inactive | out_of_stock | discontinued
  if (b.status !== undefined)    update.status    = b.status
  if (b.is_active !== undefined) update.is_active = !!b.is_active

  // Guard duplicate code if code is being changed
  if (b.code && String(b.code).trim() && String(b.code).trim() !== existing.code) {
    const dup = await Product.findOne({ company_id: req.user.company_id, code: String(b.code).trim(), _id: { $ne: existing._id } }).lean()
    if (dup) return sendError(res, `Product code "${String(b.code).trim()}" already exists.`, 409)
    update.code = String(b.code).trim()
  }

  const product = await Product.findByIdAndUpdate(req.params.id, update, { new: true }).lean()
  sendSuccess(res, product, 'Product updated.')
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/wholesaler/products/upload-image  (multipart, field: "image")
// Returns { url } — a public path the app stores in image_urls.
// ─────────────────────────────────────────────────────────────────────────────
async function uploadProductImage(req, res) {
  if (!req.file) return sendError(res, 'No image file received.', 400)
  const url = `/uploads/products/${req.file.filename}`
  sendSuccess(res, { url }, 'Image uploaded.', 201)
}

// POST /api/wholesaler/products/upload-doc  (multipart, field: "doc")
// Returns { url } — catalogue / price-list PDF path stored in catalog_pdf_url.
async function uploadProductDoc(req, res) {
  if (!req.file) return sendError(res, 'No PDF file received.', 400)
  const url = `/uploads/products/${req.file.filename}`
  sendSuccess(res, { url }, 'Document uploaded.', 201)
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/wholesaler/products/bulk-import   (multipart, field: "file")
// Bulk create + bulk price-update from an Excel/CSV.
// Header row (case-insensitive): code, name, category, sub_category, brand,
//   material, size, finish, color, thickness, purchase, selling, dealer, retail, gst
// Row with a matching own product `code` → price/spec update; else → create.
// ─────────────────────────────────────────────────────────────────────────────
async function bulkImportProducts(req, res) {
  const companyId = req.user.company_id
  if (!companyId) return sendError(res, 'No company linked to your account.', 400)
  if (!req.file)  return sendError(res, 'No file received. Upload an .xlsx or .csv.', 400)

  const ExcelJS = require('exceljs')
  const wb = new ExcelJS.Workbook()
  try {
    if (/\.csv$/i.test(req.file.originalname)) {
      await wb.csv.readFile(req.file.path)
    } else {
      await wb.xlsx.readFile(req.file.path)
    }
  } catch (e) {
    return sendError(res, 'Could not read the file. Ensure it is a valid .xlsx or .csv.', 400)
  }

  const ws = wb.worksheets[0]
  if (!ws || ws.rowCount < 2) return sendError(res, 'The sheet has no data rows.', 400)

  // Map header names → column index.
  const headerRow = ws.getRow(1)
  const col = {}
  headerRow.eachCell((cell, c) => {
    const key = String(cell.value || '').trim().toLowerCase().replace(/\s+/g, '_')
    if (key) col[key] = c
  })
  const pick = (row, ...names) => {
    for (const n of names) {
      if (col[n]) {
        const v = row.getCell(col[n]).value
        if (v !== null && v !== undefined && v !== '') return typeof v === 'object' && v.result !== undefined ? v.result : v
      }
    }
    return undefined
  }
  const numOr = (v, d = 0) => (v === undefined || v === '' || isNaN(parseFloat(v)) ? d : parseFloat(v))

  let created = 0, updated = 0, skipped = 0
  const errors = []

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const name = pick(row, 'name', 'product_name', 'design_name')
    const code = pick(row, 'code', 'product_code')
    if (!name && !code) { skipped++; continue }   // blank row

    const spec = {
      category_name:     pick(row, 'category') ? String(pick(row, 'category')).trim() : undefined,
      sub_category_name: pick(row, 'sub_category', 'subcategory') ? String(pick(row, 'sub_category', 'subcategory')).trim() : undefined,
      brand_name:        pick(row, 'brand') ? String(pick(row, 'brand')).trim() : undefined,
      material:          pick(row, 'material') ? String(pick(row, 'material')).trim() : undefined,
      size:              pick(row, 'size') ? String(pick(row, 'size')).trim() : undefined,
      finish:            pick(row, 'finish') ? String(pick(row, 'finish')).trim() : undefined,
      color:             pick(row, 'color', 'colour') ? String(pick(row, 'color', 'colour')).trim() : undefined,
      thickness:         pick(row, 'thickness') ? String(pick(row, 'thickness')).trim() : undefined,
    }
    const prices = {
      purchase_price: pick(row, 'purchase', 'purchase_rate') !== undefined ? numOr(pick(row, 'purchase', 'purchase_rate')) : undefined,
      selling_price:  pick(row, 'selling', 'selling_rate')   !== undefined ? numOr(pick(row, 'selling', 'selling_rate'))   : undefined,
      wholesale_rate: pick(row, 'dealer', 'dealer_rate', 'wholesale') !== undefined ? numOr(pick(row, 'dealer', 'dealer_rate', 'wholesale')) : undefined,
      mrp:            pick(row, 'retail', 'retail_rate', 'mrp') !== undefined ? numOr(pick(row, 'retail', 'retail_rate', 'mrp')) : undefined,
      gst_percent:    pick(row, 'gst', 'gst_percent') !== undefined ? numOr(pick(row, 'gst', 'gst_percent'), 18) : undefined,
    }
    // Drop undefined keys so we don't overwrite existing values with blanks on update.
    const clean = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))

    try {
      const codeStr = code ? String(code).trim() : ''
      const existing = codeStr
        ? await Product.findOne({ company_id: companyId, code: codeStr }).lean()
        : null

      if (existing) {
        await Product.findByIdAndUpdate(existing._id, { $set: { ...clean(spec), ...clean(prices) } })
        updated++
      } else {
        if (!name) { errors.push(`Row ${r}: new product needs a name.`); skipped++; continue }
        await Product.create({
          company_id:      companyId,
          created_by:      req.user._id || req.user.id,
          created_by_type: 'Wholesaler',
          code:            codeStr || await nextProductCode(companyId),
          name:            String(name).trim(),
          unit:            'Sq Ft',
          source:          'wholesaler',
          is_active:       true,
          status:          'active',
          ...clean(spec),
          ...clean(prices),
        })
        created++
      }
    } catch (e) {
      errors.push(`Row ${r}: ${e.message}`)
      skipped++
    }
  }

  // Best-effort cleanup of the uploaded temp file.
  try { require('fs').unlinkSync(req.file.path) } catch {}

  sendSuccess(res, { created, updated, skipped, errors: errors.slice(0, 20) },
    `Import complete: ${created} created, ${updated} updated, ${skipped} skipped.`)
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

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN (Super Admin): GET /api/wholesaler/all-products/:id
// View a single wholesaler-added product from ANY company.
// ─────────────────────────────────────────────────────────────────────────────
async function getAdminProduct(req, res) {
  if (req.user.role !== 'Super Admin') return sendError(res, 'Access denied. Super Admin only.', 403)

  const product = await Product.findById(req.params.id)
    .populate('brand_id',        'name')
    .populate('category_id',     'name')
    .populate('sub_category_id', 'name')
    .populate('company_id',      'name company_code')
    .lean()

  if (!product || product.status === 'deleted') return sendError(res, 'Product not found.', 404)

  sendSuccess(res, {
    ...product,
    company_name: product.company_id?.name || '—',
    company_code: product.company_id?.company_code || '',
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN (Super Admin): DELETE /api/wholesaler/all-products/:id
// Soft-delete a wholesaler-added product from ANY company.
// ─────────────────────────────────────────────────────────────────────────────
async function deleteAdminProduct(req, res) {
  if (req.user.role !== 'Super Admin') return sendError(res, 'Access denied. Super Admin only.', 403)

  const product = await Product.findById(req.params.id).lean()
  if (!product) return sendError(res, 'Product not found.', 404)

  await Product.findByIdAndUpdate(req.params.id, {
    status:     'deleted',
    is_active:  false,
    deleted_at: new Date(),
    deleted_by: req.user._id,
  })

  sendSuccess(res, { deleted: true }, 'Product deleted.')
}

// ═════════════════════════════════════════════════════════════════════════════
// TAXONOMY — wholesaler manages their OWN categories / sub-categories / brands
// (company-scoped). Sub-category = a Category with parent_id set.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/wholesaler/products/taxonomy
 * Returns ONLY this wholesaler's own categories (+ sub-categories) + brands.
 * No global/default (Master) entries — the wholesaler manages their own lists.
 */
async function listTaxonomy(req, res) {
  const companyId = req.user.company_id
  if (!companyId) return sendError(res, 'No company linked to your account.', 400)

  const [categories, brands] = await Promise.all([
    Category.find({ company_id: companyId, is_active: true }).sort({ name: 1 }).lean(),
    Brand.find({ company_id: companyId, is_active: true }).sort({ name: 1 }).lean(),
  ])

  const topLevel = categories.filter(c => !c.parent_id)
  const subs     = categories.filter(c => c.parent_id)

  const categoryTree = topLevel.map(c => ({
    ...c,
    sub_categories: subs.filter(s => String(s.parent_id) === String(c._id)),
  }))

  sendSuccess(res, { categories: categoryTree, brands })
}

/** POST /api/wholesaler/products/categories — { name } (top-level category). */
async function createCategory(req, res) {
  const companyId = req.user.company_id
  if (!companyId) return sendError(res, 'No company linked to your account.', 400)
  const name = String(req.body.name || '').trim()
  if (!name) return sendError(res, 'Category name is required.')

  const dup = await Category.findOne({ company_id: companyId, parent_id: null, name: new RegExp(`^${name}$`, 'i') }).lean()
  if (dup) return sendError(res, `Category "${name}" already exists.`, 409)

  const cat = await Category.create({ company_id: companyId, name, parent_id: null })
  sendSuccess(res, cat, 'Category added.', 201)
}

/** POST /api/wholesaler/products/sub-categories — { name, category_id }. */
async function createSubCategory(req, res) {
  const companyId = req.user.company_id
  if (!companyId) return sendError(res, 'No company linked to your account.', 400)
  const name = String(req.body.name || '').trim()
  const parentId = req.body.category_id
  if (!name)     return sendError(res, 'Sub-category name is required.')
  if (!parentId) return sendError(res, 'Parent category is required.')

  const parent = await Category.findOne({ _id: parentId, company_id: companyId, parent_id: null }).lean()
  if (!parent) return sendError(res, 'Parent category not found.', 404)

  const dup = await Category.findOne({ company_id: companyId, parent_id: parentId, name: new RegExp(`^${name}$`, 'i') }).lean()
  if (dup) return sendError(res, `Sub-category "${name}" already exists.`, 409)

  const sub = await Category.create({ company_id: companyId, name, parent_id: parentId })
  sendSuccess(res, sub, 'Sub-category added.', 201)
}

/** POST /api/wholesaler/products/brands — { name }. */
async function createBrand(req, res) {
  const companyId = req.user.company_id
  if (!companyId) return sendError(res, 'No company linked to your account.', 400)
  const name = String(req.body.name || '').trim()
  if (!name) return sendError(res, 'Brand name is required.')

  const dup = await Brand.findOne({ company_id: companyId, name: new RegExp(`^${name}$`, 'i') }).lean()
  if (dup) return sendError(res, `Brand "${name}" already exists.`, 409)

  const brand = await Brand.create({ company_id: companyId, name })
  sendSuccess(res, brand, 'Brand added.', 201)
}

/** DELETE /api/wholesaler/products/categories/:id — blocked if it has sub-categories or products. */
async function deleteCategory(req, res) {
  const companyId = req.user.company_id
  const cat = await Category.findOne({ _id: req.params.id, company_id: companyId }).lean()
  if (!cat) return sendError(res, 'Category not found.', 404)

  const subCount = await Category.countDocuments({ company_id: companyId, parent_id: cat._id })
  if (subCount > 0) return sendError(res, `Delete the ${subCount} sub-categorie(s) first.`, 409)

  const prodCount = await Product.countDocuments({ company_id: companyId, category_id: cat._id, status: { $ne: 'deleted' } })
  if (prodCount > 0) return sendError(res, `This category has ${prodCount} product(s). Remove them first.`, 409)

  await Category.deleteOne({ _id: cat._id, company_id: companyId })
  sendSuccess(res, { deleted: true }, 'Category deleted.')
}

/** DELETE /api/wholesaler/products/sub-categories/:id */
async function deleteSubCategory(req, res) {
  const companyId = req.user.company_id
  const sub = await Category.findOne({ _id: req.params.id, company_id: companyId, parent_id: { $ne: null } }).lean()
  if (!sub) return sendError(res, 'Sub-category not found.', 404)

  const prodCount = await Product.countDocuments({ company_id: companyId, sub_category_id: sub._id, status: { $ne: 'deleted' } })
  if (prodCount > 0) return sendError(res, `This sub-category has ${prodCount} product(s). Remove them first.`, 409)

  await Category.deleteOne({ _id: sub._id, company_id: companyId })
  sendSuccess(res, { deleted: true }, 'Sub-category deleted.')
}

/** DELETE /api/wholesaler/products/brands/:id */
async function deleteBrand(req, res) {
  const companyId = req.user.company_id
  const brand = await Brand.findOne({ _id: req.params.id, company_id: companyId }).lean()
  if (!brand) return sendError(res, 'Brand not found.', 404)

  const prodCount = await Product.countDocuments({ company_id: companyId, brand_id: brand._id, status: { $ne: 'deleted' } })
  if (prodCount > 0) return sendError(res, `This brand has ${prodCount} product(s). Remove them first.`, 409)

  await Brand.deleteOne({ _id: brand._id, company_id: companyId })
  sendSuccess(res, { deleted: true }, 'Brand deleted.')
}

module.exports = {
  listCatalog, getCatalogProduct, getFilters, createProduct, updateProduct, uploadProductImage, uploadProductDoc, bulkImportProducts, listMyProducts, deleteProduct,
  getAdminProduct, deleteAdminProduct,
  listTaxonomy, createCategory, createSubCategory, createBrand,
  deleteCategory, deleteSubCategory, deleteBrand,
}
