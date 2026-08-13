const mongoose = require('mongoose')

const productSchema = new mongoose.Schema({
  company_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  code:            { type: String, required: true, trim: true },
  name:            { type: String, required: true, trim: true },
  alias:           { type: String, default: '' },
  brand_id:        { type: mongoose.Schema.Types.ObjectId, ref: 'Brand', default: null },
  category_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
  sub_category_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
  // Basic
  hsn_code:       { type: String, default: '' },
  size:           { type: String, default: '' },
  finish:         { type: String, default: '' },
  material:       { type: String, default: '' },
  color:          { type: String, default: '' },
  // Tile-specific specs
  surface:        { type: String, default: '' },
  thickness:      { type: String, default: '' },
  grade:          { type: String, default: '' },
  tile_type:      { type: String, default: '' },
  application:    { type: String, default: '' },
  anti_skid:      { type: String, default: '' },
  origin:         { type: String, default: '' },
  manufacturer:   { type: String, default: '' },
  barcode:        { type: String, default: '' },
  // Packing
  design:         { type: String, default: '' },
  collection:     { type: String, default: '' },
  pcs_per_box:    { type: Number, default: null },
  sqft_per_box:   { type: Number, default: null },
  weight_per_box: { type: Number, default: null },
  // Unit & tax
  unit:           { type: String, default: 'Sq Ft' },
  gst_percent:    { type: Number, default: 18 },
  description:    { type: String, default: '' },
  // Pricing
  purchase_price:   { type: Number, default: 0 },
  landing_cost:     { type: Number, default: 0 },
  selling_price:    { type: Number, default: 0 },
  dealer_price:     { type: Number, default: 0 },
  retail_price:     { type: Number, default: 0 },
  mrp:              { type: Number, default: 0 },
  wholesale_rate:   { type: Number, default: 0 },
  project_rate:     { type: Number, default: 0 },
  min_selling_rate: { type: Number, default: 0 },
  min_stock_level:  { type: Number, default: 0 },
  reorder_level:    { type: Number, default: 0 },
  // Status & type
  is_active:      { type: Boolean, default: true },
  status:         { type: String, enum: ['active', 'deleted'], default: 'active' },
  sales_type:     { type: String, default: 'Regular Sale' },
  product_type:   { type: String, default: 'Regular Product' },
  // Flags
  new_arrival:     { type: Boolean, default: false },
  featured:        { type: Boolean, default: false },
  online_visible:  { type: Boolean, default: true },
  dealer_visible:  { type: Boolean, default: true },
  // Images
  image_urls:     { type: [String], default: [] },
  // Soft delete
  deleted_at:     { type: Date, default: null },
  deleted_by:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })

productSchema.index({ company_id: 1 })
productSchema.index({ code: 1, company_id: 1 }, { unique: true })
productSchema.index({ company_id: 1, status: 1 })

const ProductModel = mongoose.model('Product', productSchema)

// ── Shared populate helper ────────────────────────────────────
function _populate(doc) {
  if (!doc) return null
  return {
    ...doc,
    brand_name:        doc.brand_id?.name        || null,
    category_name:     doc.category_id?.name     || null,
    sub_category_name: doc.sub_category_id?.name || null,
  }
}

class Product {
  static async findAll(company_id, filters = {}) {
    const { search, brand, category, sub_category, finish, material, is_active, limit = 20, offset = 0 } = filters
    const query = { company_id, status: { $ne: 'deleted' } }
    if (search)       query.$or = [{ name: { $regex: search, $options: 'i' } }, { code: { $regex: search, $options: 'i' } }]
    if (finish)       query.finish = finish
    if (material)     query.material = material
    if (sub_category) query.sub_category_id = sub_category
    if (is_active !== undefined) query.is_active = is_active !== 'false'

    const docs = await ProductModel.find(query)
      .populate('brand_id', 'name')
      .populate('category_id', 'name')
      .populate('sub_category_id', 'name')
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(limit)
      .lean()
    return docs.map(_populate)
  }

  static async count(company_id, filters = {}) {
    const { search, finish, material, is_active } = filters
    const query = { company_id, status: { $ne: 'deleted' } }
    if (search)      query.$or = [{ name: { $regex: search, $options: 'i' } }, { code: { $regex: search, $options: 'i' } }]
    if (finish)      query.finish = finish
    if (material)    query.material = material
    if (is_active !== undefined) query.is_active = is_active !== 'false'
    return ProductModel.countDocuments(query)
  }

  static async findById(id, company_id) {
    const doc = await ProductModel.findOne({ _id: id, company_id })
      .populate('brand_id', 'name')
      .populate('category_id', 'name')
      .populate('sub_category_id', 'name')
      .lean()
    return _populate(doc)
  }

  static async findByCode(code, company_id) {
    return ProductModel.findOne({ code, company_id, status: { $ne: 'deleted' } }).lean()
  }

  static async create(company_id, data) {
    const {
      code, name, alias, brand_id, category_id, sub_category_id,
      hsn_code, size, finish, material, color,
      surface, thickness, grade, tile_type, application, anti_skid,
      origin, manufacturer, barcode,
      design, collection, pcs_per_box, sqft_per_box, weight_per_box,
      unit, gst_percent, description,
      purchase_price, landing_cost, selling_price, dealer_price, retail_price, mrp,
      wholesale_rate, project_rate, min_selling_rate, min_stock_level, reorder_level,
      is_active, sales_type, product_type,
      new_arrival, featured, online_visible, dealer_visible,
      image_urls,
    } = data
    const product = await ProductModel.create({
      company_id, code, name,
      alias:           alias           || '',
      brand_id:        brand_id        || null,
      category_id:     category_id     || null,
      sub_category_id: sub_category_id || null,
      hsn_code:        hsn_code        || '',
      size:            size            || '',
      finish:          finish          || '',
      material:        material        || '',
      color:           color           || '',
      surface:         surface         || '',
      thickness:       thickness       || '',
      grade:           grade           || '',
      tile_type:       tile_type       || '',
      application:     application     || '',
      anti_skid:       anti_skid       || '',
      origin:          origin          || '',
      manufacturer:    manufacturer    || '',
      barcode:         barcode         || '',
      design:          design          || '',
      collection:      collection      || '',
      pcs_per_box:     pcs_per_box     != null ? parseFloat(pcs_per_box)     : null,
      sqft_per_box:    sqft_per_box    != null ? parseFloat(sqft_per_box)    : null,
      weight_per_box:  weight_per_box  != null ? parseFloat(weight_per_box)  : null,
      unit:            unit            || 'Sq Ft',
      gst_percent:     gst_percent     || 18,
      description:     description     || '',
      purchase_price:  parseFloat(purchase_price)    || 0,
      landing_cost:    parseFloat(landing_cost)       || 0,
      selling_price:   parseFloat(selling_price)      || 0,
      dealer_price:    parseFloat(dealer_price)       || 0,
      retail_price:    parseFloat(retail_price)       || 0,
      mrp:             parseFloat(mrp)                || 0,
      wholesale_rate:  parseFloat(wholesale_rate)     || 0,
      project_rate:    parseFloat(project_rate)       || 0,
      min_selling_rate:parseFloat(min_selling_rate)   || 0,
      min_stock_level: parseFloat(min_stock_level)    || 0,
      reorder_level:   parseFloat(reorder_level)      || 0,
      is_active:       is_active !== false,
      status:          'active',
      sales_type:      sales_type   || 'Regular Sale',
      product_type:    product_type || 'Regular Product',
      new_arrival:     !!new_arrival,
      featured:        !!featured,
      online_visible:  online_visible  !== false,
      dealer_visible:  dealer_visible  !== false,
      image_urls:      Array.isArray(image_urls) ? image_urls : [],
    })
    return product.toObject()
  }

  static async update(id, company_id, data) {
    const {
      name, alias, brand_id, category_id, sub_category_id,
      hsn_code, size, finish, material, color,
      surface, thickness, grade, tile_type, application, anti_skid,
      origin, manufacturer, barcode,
      design, collection, pcs_per_box, sqft_per_box, weight_per_box,
      unit, gst_percent, description,
      purchase_price, landing_cost, selling_price, dealer_price, retail_price, mrp,
      wholesale_rate, project_rate, min_selling_rate, min_stock_level, reorder_level,
      is_active, sales_type, product_type,
      new_arrival, featured, online_visible, dealer_visible,
      image_urls,
    } = data

    const updateData = {
      name,
      alias:           alias           ?? '',
      brand_id:        brand_id        || null,
      category_id:     category_id     || null,
      sub_category_id: sub_category_id || null,
      hsn_code:        hsn_code        ?? '',
      size:            size            ?? '',
      finish:          finish          ?? '',
      material:        material        ?? '',
      color:           color           ?? '',
      surface:         surface         ?? '',
      thickness:       thickness       ?? '',
      grade:           grade           ?? '',
      tile_type:       tile_type       ?? '',
      application:     application     ?? '',
      anti_skid:       anti_skid       ?? '',
      origin:          origin          ?? '',
      manufacturer:    manufacturer    ?? '',
      barcode:         barcode         ?? '',
      design:          design          ?? '',
      collection:      collection      ?? '',
      pcs_per_box:     pcs_per_box     != null ? parseFloat(pcs_per_box)     : null,
      sqft_per_box:    sqft_per_box    != null ? parseFloat(sqft_per_box)    : null,
      weight_per_box:  weight_per_box  != null ? parseFloat(weight_per_box)  : null,
      unit:            unit            ?? 'Sq Ft',
      gst_percent:     gst_percent     ?? 18,
      description:     description     ?? '',
      purchase_price:  parseFloat(purchase_price)    || 0,
      landing_cost:    parseFloat(landing_cost)       || 0,
      selling_price:   parseFloat(selling_price)      || 0,
      dealer_price:    parseFloat(dealer_price)       || 0,
      retail_price:    parseFloat(retail_price)       || 0,
      mrp:             parseFloat(mrp)                || 0,
      wholesale_rate:  parseFloat(wholesale_rate)     || 0,
      project_rate:    parseFloat(project_rate)       || 0,
      min_selling_rate:parseFloat(min_selling_rate)   || 0,
      min_stock_level: parseFloat(min_stock_level)    || 0,
      reorder_level:   parseFloat(reorder_level)      || 0,
      is_active:       is_active !== false,
      sales_type:      sales_type   || 'Regular Sale',
      product_type:    product_type || 'Regular Product',
      new_arrival:     !!new_arrival,
      featured:        !!featured,
      online_visible:  online_visible  !== false,
      dealer_visible:  dealer_visible  !== false,
      ...(image_urls !== undefined && { image_urls: Array.isArray(image_urls) ? image_urls : [] }),
    }

    // Remove undefined keys so we don't accidentally unset fields
    Object.keys(updateData).forEach(k => updateData[k] === undefined && delete updateData[k])

    return ProductModel.findOneAndUpdate(
      { _id: id, company_id, status: { $ne: 'deleted' } },
      updateData,
      { new: true }
    ).lean()
  }

  static async softDelete(id, company_id, deleted_by) {
    return ProductModel.findOneAndUpdate(
      { _id: id, company_id, status: { $ne: 'deleted' } },
      { status: 'deleted', deleted_at: new Date(), deleted_by: deleted_by || null },
      { new: true }
    ).lean()
  }

  static async restore(id, company_id) {
    return ProductModel.findOneAndUpdate(
      { _id: id, company_id, status: 'deleted' },
      { status: 'active', deleted_at: null, deleted_by: null },
      { new: true }
    ).lean()
  }

  static async findDeleted(company_id, filters = {}) {
    const { search, limit = 100, offset = 0 } = filters
    const query = { company_id, status: 'deleted' }
    if (search) query.$or = [{ name: { $regex: search, $options: 'i' } }, { code: { $regex: search, $options: 'i' } }]
    const docs = await ProductModel.find(query)
      .populate('brand_id', 'name')
      .populate('category_id', 'name')
      .populate('sub_category_id', 'name')
      .sort({ deleted_at: -1 })
      .skip(offset)
      .limit(limit)
      .lean()
    return docs.map(_populate)
  }

  static async addImages(id, company_id, imageUrls) {
    return ProductModel.findOneAndUpdate(
      { _id: id, company_id },
      { $push: { image_urls: { $each: imageUrls } } },
      { new: true }
    ).lean()
  }

  static async removeImage(id, company_id, imageUrl) {
    return ProductModel.findOneAndUpdate(
      { _id: id, company_id },
      { $pull: { image_urls: imageUrl } },
      { new: true }
    ).lean()
  }

  // Legacy hard-delete (keep for internal use only)
  static async delete(id, company_id) {
    const result = await ProductModel.deleteOne({ _id: id, company_id })
    return result.deletedCount > 0
  }

  static async search(filters = {}) {
    const { q, category, brand, finish, material, color, size, min_price, max_price, limit = 20, offset = 0 } = filters
    const query = { is_active: true, status: { $ne: 'deleted' } }
    if (q)         query.$or = [{ name: { $regex: q, $options: 'i' } }, { code: { $regex: q, $options: 'i' } }]
    if (finish)    query.finish   = finish
    if (material)  query.material = material
    if (color)     query.color    = { $regex: color, $options: 'i' }
    if (size)      query.size     = { $regex: size,  $options: 'i' }
    if (min_price) query.selling_price = { ...query.selling_price, $gte: parseFloat(min_price) }
    if (max_price) query.selling_price = { ...query.selling_price, $lte: parseFloat(max_price) }

    const docs = await ProductModel.find(query)
      .populate('brand_id', 'name')
      .populate('category_id', 'name')
      .populate('sub_category_id', 'name')
      .sort({ name: 1 })
      .skip(offset)
      .limit(limit)
      .lean()
    return docs.map(_populate)
  }

  static async searchCount(filters = {}) {
    const { q, finish, material, color, size, min_price, max_price } = filters
    const query = { is_active: true, status: { $ne: 'deleted' } }
    if (q)         query.$or = [{ name: { $regex: q, $options: 'i' } }, { code: { $regex: q, $options: 'i' } }]
    if (finish)    query.finish   = finish
    if (material)  query.material = material
    if (color)     query.color    = { $regex: color, $options: 'i' }
    if (size)      query.size     = { $regex: size,  $options: 'i' }
    if (min_price) query.selling_price = { ...query.selling_price, $gte: parseFloat(min_price) }
    if (max_price) query.selling_price = { ...query.selling_price, $lte: parseFloat(max_price) }
    return ProductModel.countDocuments(query)
  }
}

module.exports = Product
module.exports.ProductModel = ProductModel
