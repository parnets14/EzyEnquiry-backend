const mongoose = require('mongoose')

const productSchema = new mongoose.Schema(
  {
    company_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    created_by:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, immutable: true },
    created_by_type: { type: String, enum: ['Admin', 'Wholesaler', 'Retailer'], default: null, immutable: true },
    code:            { type: String, required: true, trim: true },
    name:            { type: String, required: true, trim: true },
    alias:           { type: String, default: '' },
    brand_id:        { type: mongoose.Schema.Types.ObjectId, ref: 'Brand', default: null },
    category_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    sub_category_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    // Free-text taxonomy names — used when picking from the global Master lists
    // (wholesaler app) instead of per-company Brand/Category documents.
    brand_name:        { type: String, default: '' },
    category_name:     { type: String, default: '' },
    sub_category_name: { type: String, default: '' },

    // Basic specs
    hsn_code:     { type: String, default: '' },
    size:         { type: String, default: '' },
    finish:       { type: String, default: '' },
    material:     { type: String, default: '' },
    color:        { type: String, default: '' },

    // Tile-specific specs
    surface:      { type: String, default: '' },
    thickness:    { type: String, default: '' },
    grade:        { type: String, default: '' },
    tile_type:    { type: String, default: '' },
    application:  { type: String, default: '' },
    anti_skid:    { type: String, default: '' },
    origin:       { type: String, default: '' },
    manufacturer: { type: String, default: '' },
    barcode:      { type: String, default: '' },

    // Packing
    design:         { type: String, default: '' },
    collection:     { type: String, default: '' },
    pcs_per_box:    { type: Number, default: null },
    sqft_per_box:   { type: Number, default: null },
    weight_per_box: { type: Number, default: null },

    // Unit & tax
    unit:        { type: String, default: 'Sq Ft' },
    gst_percent: { type: Number, default: 18 },
    description: { type: String, default: '' },

    // Category-specific dynamic fields (granite/marble/tiles/sanitaryware/blocks…).
    // Shape is driven by the app's per-category field schema, e.g.
    //   { granite_type, colour, slab_format, length_ft, width_ft, thickness_cm, ... }
    attributes:  { type: mongoose.Schema.Types.Mixed, default: {} },
    // The category "type" the attributes belong to (granite|marble|tiles|sanitaryware|blocks|other)
    category_type: { type: String, default: '' },
    // Opening stock captured at add time (actual live stock lives in Inventory).
    opening_stock: { type: Number, default: 0 },

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
    // Discount % fields (off MRP)
    retail_discount:    { type: Number, default: 0 },
    dealer_discount:    { type: Number, default: 0 },
    wholesale_discount: { type: Number, default: 0 },
    project_discount:   { type: Number, default: 0 },
    min_stock_level:  { type: Number, default: 0 },
    reorder_level:    { type: Number, default: 0 },

    // Status & classification
    is_active:    { type: Boolean, default: true },
    status:       { type: String, enum: ['active', 'deleted'], default: 'active' },
    sales_type:   { type: String, default: 'Regular Sale' },
    product_type: { type: String, default: 'Regular Product' },
    source:       { type: String, default: 'admin' },   // 'admin' | 'wholesaler'

    // Per-company access control (applies to Admin-created products only)
    // When shared_with_all is true, every wholesaler/retailer can see it.
    // When false, only companies whose company_code is in allowed_company_codes see it.
    shared_with_all:      { type: Boolean, default: true },
    allowed_company_codes: { type: [String], default: [] },

    // Visibility flags
    new_arrival:    { type: Boolean, default: false },
    featured:       { type: Boolean, default: false },
    online_visible: { type: Boolean, default: true },
    dealer_visible: { type: Boolean, default: true },

    // Images
    image_urls: { type: [String], default: [] },
    // Optional catalogue / price-list PDF attachment
    catalog_pdf_url: { type: String, default: '' },

    // Soft delete
    deleted_at:         { type: Date, default: null },
    deleted_by:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    deleted_was_active: { type: Boolean, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
)

productSchema.index({ company_id: 1 })
productSchema.index({ code: 1, company_id: 1 }, { unique: true })
productSchema.index({ company_id: 1, status: 1 })

module.exports = mongoose.model('Product', productSchema)
