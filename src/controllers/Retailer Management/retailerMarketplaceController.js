const crypto = require('crypto')
const mongoose = require('mongoose')

const Product = require('../../models/Product Management/Product')
const Brand = require('../../models/Product Management/Brand')
const Category = require('../../models/Product Management/Category')
const Inventory = require('../../models/Purchase & Inventory Management/Inventory')
const Company = require('../../models/Company Management/Company')
const Enquiry = require('../../models/Marketplace Management/Enquiry')
const EnquiryOffer = require('../../models/Marketplace Management/EnquiryOffer')
const EnquiryMessage = require('../../models/Marketplace Management/EnquiryMessage')
const EnquiryReplyHistory = require('../../models/Marketplace Management/EnquiryReplyHistory')
const Order = require('../../models/Marketplace Management/Order')
const { deductStockForOrder, restoreStockForOrder, releaseReserveForOrder } = require('../Purchase & Inventory Management/inventoryController')
const Dispatch = require('../../models/Marketplace Management/Dispatch')
const Invoice = require('../../models/Finance Management/Invoice')
const Notification = require('../../models/System Management/Notification')
const Quotation = require('../../models/Finance Management/Quotation')
const Customer = require('../../models/CRM Management/Customer')
const User = require('../../models/User Management/User')
const { sendError, paginate } = require('../../utils/helpers')
const { notifyRetailer, notifySeller } = require('../../utils/pushHelper')

const PRODUCT_SELECT = [
  'company_id', 'code', 'name', 'alias', 'brand_id', 'category_id', 'sub_category_id',
  'hsn_code', 'size', 'finish', 'material', 'color', 'surface', 'thickness', 'grade',
  'tile_type', 'application', 'anti_skid', 'origin', 'manufacturer', 'barcode', 'design', 'collection',
  'pcs_per_box', 'sqft_per_box', 'weight_per_box', 'unit', 'gst_percent', 'description',
  'selling_price', 'dealer_price', 'retail_price', 'mrp', 'sales_type', 'product_type',
  // Extra price fields the catalog/app shows (purchase + wholesale + project + landing).
  'purchase_price', 'wholesale_rate', 'project_rate', 'landing_cost', 'min_selling_rate',
  'new_arrival', 'featured', 'online_visible', 'is_active', 'status', 'image_urls', 'created_by_type',
  'created_at', 'updated_at',
].join(' ')

// Browsing is shared across Admin, Wholesaler, and Retailer products. Legacy
// records with missing lifecycle defaults remain visible unless explicitly
// inactive or deleted; seller approval is enforced separately for enquiries.
const CATALOG_PRODUCT_QUERY = {
  is_active: { $ne: false },
  status: { $ne: 'deleted' },
}

// Maps every backend order status → the 6-stage status the Retailer App expects.
// Legacy strings are kept so that old DB records still render correctly.
const ANDROID_STATUS = {
  // Current 6-stage statuses (pass through)
  New:               'New',
  Accepted:          'Accepted',
  Packing:           'Packing',
  Dispatched:        'Dispatched',
  'Out for Delivery':'Out for Delivery',
  Delivered:         'Delivered',
  Cancelled:         'Cancelled',
  // Legacy backward-compat
  'Pending Approval':     'Accepted',
  Approved:               'Accepted',
  'Picking Started':      'Packing',
  'Picking Completed':    'Packing',
  'Sorting Started':      'Packing',
  'Sorting Completed':    'Packing',
  'Packing Started':      'Packing',
  'Packing Completed':    'Packing',
  'Invoice Generated':    'Packing',
  'Ready for Dispatch':   'Dispatched',
  Ready:                  'Dispatched',
  'Partially Dispatched': 'Dispatched',
  'In Transit':           'Out for Delivery',
}

const STATUS_GROUPS = Object.entries(ANDROID_STATUS).reduce((groups, [internal, external]) => {
  groups[external] = [...(groups[external] || []), internal]
  return groups
}, {})

function ok(res, data, message = 'Success', statusCode = 200, pagination = null) {
  const body = { success: true, message, data }
  if (pagination) body.pagination = pagination
  return res.status(statusCode).json(body)
}

function parsePagination(query, defaultLimit = 20) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1)
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), 100)
  return { page, limit, skip: (page - 1) * limit }
}

// Per-company access control for ADMIN products. Non-admin (wholesaler/retailer)
// listings are always visible. Admin products only show when shared_with_all
// or the caller's company_code is in allowed_company_codes.
async function buildAccessClause(req) {
  let myCode = null
  if (req?.user?.company_id) {
    const company = await Company.findById(req.user.company_id).select('company_code').lean()
    myCode = company?.company_code ? String(company.company_code).trim().toUpperCase() : null
  }
  // Admin products are HIDDEN by default. They only become visible when the
  // admin explicitly grants access — either by sharing with everyone
  // (shared_with_all: true) or by adding this company's code to
  // allowed_company_codes. No access granted → not shown to anyone.
  const adminAllowed = [{ shared_with_all: true }]
  if (myCode) adminAllowed.push({ allowed_company_codes: myCode })
  return {
    $or: [
      { created_by_type: { $ne: 'Admin' } },
      { $and: [{ created_by_type: 'Admin' }, { $or: adminAllowed }] },
    ],
  }
}

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value)
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function money(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

function nonNegative(value, field) {
  const number = Number(value || 0)
  if (!Number.isFinite(number) || number < 0) throw Object.assign(new Error(`${field} must be a non-negative number.`), { status: 400 })
  return money(number)
}

// A product created by the platform Admin is pre-trusted: Admin is the approval
// authority, so its products are always enquirable regardless of the owner
// company's approval status. Third-party sellers (Wholesaler) must still be an
// approved, active, non-Retailer company. Retailer-owned products are never
// enquiry targets (browse-only). Requires product.online_visible.
function isEnquirableProduct(product) {
  // Enquiries are allowed on every catalogue product that is online-visible,
  // regardless of who added it (Admin, Wholesaler, or Retailer). The only
  // exclusion — a retailer enquiring on their OWN product — is handled at the
  // response/creation layer where the viewer's company is known.
  if (!product || product.online_visible === false) return false
  return true
}

function productResponse(product, stock = undefined, viewer = null) {
  const seller = product.company_id || {}
  // `stock` is undefined when the seller keeps no inventory record for this
  // listing (common for Admin catalogue / enquiry-only products). In that case
  // the product is treated as available rather than forced Out of Stock. When
  // an inventory record exists, its real quantity drives availability.
  const tracksInventory = stock !== undefined && stock !== null
  const stockQty = Math.max(Number(stock) || 0, 0)
  const inStock = tracksInventory ? stockQty > 0 : true
  const legacyCode = String(product.code || '').toUpperCase()
  const sellerType = String(seller.biz_type || '').toLowerCase()
  const inferredCreatorType = sellerType.includes('retail')
    ? 'Retailer'
    : sellerType.includes('whole')
      ? 'Wholesaler'
      : legacyCode.startsWith('RPD-') ? 'Retailer' : 'Unknown'
  const canManage = viewer?.role === 'Retailer'
    && seller?._id
    && String(viewer.company_id) === String(seller._id)
  // Enquiry is offered on every product except the viewer's own listing.
  const ownsProduct = seller?._id && viewer?.company_id
    && String(viewer.company_id) === String(seller._id)
  const canEnquire = isEnquirableProduct(product) && !ownsProduct

  return {
    _id: product._id,   // the app keys lists and navigates by _id
    id: product._id,
    code: product.code,
    name: product.name,
    alias: product.alias || '',
    brand: product.brand_id ? { id: product.brand_id._id, name: product.brand_id.name, code: product.brand_id.code || '' } : null,
    category: product.category_id ? { id: product.category_id._id, name: product.category_id.name, code: product.category_id.code || '' } : null,
    sub_category: product.sub_category_id ? { id: product.sub_category_id._id, name: product.sub_category_id.name, code: product.sub_category_id.code || '' } : null,
    specs: {
      hsn_code: product.hsn_code || '', size: product.size || '', finish: product.finish || '',
      material: product.material || '', color: product.color || '', surface: product.surface || '',
      thickness: product.thickness || '', grade: product.grade || '', tile_type: product.tile_type || '',
      application: product.application || '', anti_skid: product.anti_skid || '', origin: product.origin || '',
      manufacturer: product.manufacturer || '', barcode: product.barcode || '',
      design: product.design || '', collection: product.collection || '',
    },
    // Also expose spec fields at the top level — the app's ProductDetail screen
    // reads product.size / finish / material / … directly (not the nested specs).
    hsn_code: product.hsn_code || '',
    size: product.size || '',
    finish: product.finish || '',
    material: product.material || '',
    color: product.color || '',
    surface: product.surface || '',
    thickness: product.thickness || '',
    grade: product.grade || '',
    tile_type: product.tile_type || '',
    application: product.application || '',
    anti_skid: product.anti_skid || '',
    origin: product.origin || '',
    manufacturer: product.manufacturer || '',
    barcode: product.barcode || '',
    design: product.design || '',
    collection: product.collection || '',
    packing: {
      pcs_per_box: product.pcs_per_box,
      sqft_per_box: product.sqft_per_box,
      weight_per_box: product.weight_per_box,
    },
    unit: product.unit,
    gst_percent: product.gst_percent,
    description: product.description || '',
    prices: {
      selling_price: product.selling_price,
      dealer_price: product.dealer_price,
      retail_price: product.retail_price,
      wholesale_rate: product.wholesale_rate,
      purchase_price: product.purchase_price,
      project_rate: product.project_rate,
      landing_cost: product.landing_cost,
      min_selling_rate: product.min_selling_rate,
      mrp: product.mrp,
    },
    // Also expose the common price fields at the top level — the mobile app's
    // product card reads item.purchase_price / selling_price / wholesale_rate / mrp
    // directly (not the nested `prices` object).
    purchase_price: product.purchase_price,
    selling_price: product.selling_price,
    wholesale_rate: product.wholesale_rate,
    dealer_price: product.dealer_price,
    retail_price: product.retail_price,
    project_rate: product.project_rate,
    landing_cost: product.landing_cost,
    min_selling_rate: product.min_selling_rate,
    mrp: product.mrp,
    classification: {
      sales_type: product.sales_type || '',
      product_type: product.product_type || '',
    },
    flags: { new_arrival: !!product.new_arrival, featured: !!product.featured },
    image_urls: product.image_urls || [],
    visible_stock: stockQty,
    in_stock: inStock,
    tracks_inventory: tracksInventory,
    // Always-present owner company id (the company that owns this product),
    // so the app can load that company's customers even if `seller` is trimmed.
    owner_company_id: seller?._id || product.company_id?._id || product.company_id || null,
    seller: seller?._id ? {
      id: seller._id,
      company_code: seller.company_code || '',
      name: seller.name || '',
      city: seller.city || '',
      state: seller.state || '',
      biz_type: seller.biz_type || '',
      status: seller.status || '',
      verified: seller.status === 'Approved' && seller.is_active !== false,
    } : null,
    added_by_type: product.created_by_type || inferredCreatorType,
    can_manage: !!canManage,
    can_enquire: canEnquire,
    created_at: product.created_at,
    updated_at: product.updated_at,
  }
}

function enquiryResponse(enquiry, quotation = null, viewerCompanyId = null) {
  const seller = enquiry.seller_company_id || enquiry.company_id || {}
  const product = enquiry.product_id || {}
  // The quotation the retailer submitted (rate/discount/GST/charges/total). For
  // admin-product enquiries this is the self-quote created on send.
  const q = quotation
  const qItem = (q && q.items && q.items[0]) || {}
  const quotationBlock = q ? {
    quotation_no: q.quotation_no || '',
    rate: qItem.rate ?? enquiry.offered_price ?? null,
    discount: qItem.disc ?? 0,
    gst_percent: qItem.gst_percent ?? null,
    subtotal: q.subtotal ?? null,
    gst_amount: q.gst_amount ?? null,
    freight_charges: q.freight_charges ?? 0,
    other_charges: q.other_charges ?? 0,
    grand_total: q.grand_total ?? null,
    status: q.status || '',
  } : null
  // The customer this quotation is for (captured in the enquiry form).
  const customerBlock = {
    name: (q && q.customer_name) || '',
    mobile: (q && q.customer_phone) || '',
    email: (q && q.customer_email) || '',
  }
  // Who created/sent this (the retailer business + person + contact).
  const createdByBlock = {
    name: (q && (q.created_by_person || q.created_by_name)) || (enquiry.retailer_name || ''),
    company: (q && q.created_by_company) || (enquiry.retailer_name || ''),
    mobile: (q && q.created_by_mobile) || (enquiry.retailer_mobile || ''),
    email: (q && q.created_by_email) || (enquiry.retailer_email || ''),
    type: (q && q.created_by_type) || 'Retailer App',
    label: (q && q.created_by_name) || '',
  }

  // Which side of this enquiry is the viewer on? A broadcast row carries the
  // RECIPIENT as `company_id` and the SENDER as `buyer_company_id`, so the same
  // document reads as "received" in one app and "raised" in another. The app
  // uses this to choose between the availability+price reply form (received) and
  // the buyer's offer/withdraw actions (raised).
  const recipientId = enquiry.company_id?._id || enquiry.company_id || null
  const isRecipient = !!(viewerCompanyId && recipientId
    && String(recipientId) === String(viewerCompanyId))

  return {
    id: enquiry._id,
    enquiry_code: enquiry.enq_code,
    status: enquiry.status,
    qty: enquiry.qty,
    unit: enquiry.unit,
    location: enquiry.location || '',
    remarks: enquiry.remarks || '',
    seller_reply: enquiry.distributor_reply || '',
    accepted_offer_price: enquiry.offered_price,
    // The recipient's availability + timeline, so the sender can read a reply
    // without opening the offer thread.
    available_quantity: enquiry.available_quantity ?? null,
    delivery_timeline: enquiry.delivery_timeline || '',
    is_recipient: isRecipient,
    direction: isRecipient ? 'received' : 'raised',
    broadcast_audience: enquiry.broadcast_audience || '',
    quotation: quotationBlock,
    customer: customerBlock,
    created_by: createdByBlock,
    product: product?._id ? {
      id: product._id,
      code: enquiry.product_code || product.code || '',
      name: enquiry.product_name || product.name || '',
      image_urls: product.image_urls || [],
    } : { id: null, code: enquiry.product_code || '', name: enquiry.product_name || '', image_urls: [] },
    // Who owns/created this product listing. Retailer enquiries here are on
    // Admin products, so present it as the official platform catalogue.
    added_by_type: enquiry.source === 'Retailer App' ? 'Admin' : (product.created_by_type || 'Admin'),
    seller: seller?._id
      ? { id: seller._id, name: seller.name || 'EzyEnquiry Official', city: seller.city || '', state: seller.state || '' }
      : { id: null, name: 'EzyEnquiry Official', city: '', state: '' },
    // Who ASKED. On a broadcast row `seller_company_id` is the RECIPIENT — i.e.
    // the retailer itself — so a received enquiry would otherwise show the
    // retailer's own name as the party. The app uses this for received rows.
    // Requires `buyer_company_id` to be populated (name/city/state).
    sender: enquiry.buyer_company_id?._id
      ? {
          id: enquiry.buyer_company_id._id,
          name: enquiry.buyer_company_id.name || '',
          city: enquiry.buyer_company_id.city || '',
          state: enquiry.buyer_company_id.state || '',
        }
      : null,
    order_id: enquiry.order_id || null,
    created_at: enquiry.created_at,
    updated_at: enquiry.updated_at,
  }
}

function offerResponse(offer) {
  const seller = offer.seller_company_id || {}
  return {
    id: offer._id,
    enquiry_id: offer.enquiry_id,
    status: offer.status,
    qty: offer.qty,
    unit: offer.unit,
    unit_price: offer.unit_price,
    gst_percent: offer.gst_percent,
    amount: offer.amount,
    gst_amount: offer.gst_amount,
    charges: {
      transport: offer.transport_charge,
      packing: offer.packing_charge,
      other: offer.other_charge,
    },
    total_amount: offer.total_amount,
    available_quantity: offer.available_quantity ?? null,
    delivery_timeline: offer.delivery_timeline || '',
    notes: offer.notes || '',
    seller: seller?._id ? { id: seller._id, name: seller.name || '', city: seller.city || '', state: seller.state || '' } : null,
    responded_at: offer.responded_at,
    created_at: offer.created_at,
    updated_at: offer.updated_at,
  }
}

function orderResponse(order) {
  const seller = order.seller_company_id || order.company_id || {}
  return {
    id: order._id,
    order_code: order.order_code,
    enquiry_id: order.enquiry_id,
    enquiry_code: order.enquiry_code || '',
    offer_id: order.offer_id,
    status: ANDROID_STATUS[order.status] || 'Packing',
    internal_status: order.status,
    product: {
      id: order.product_id?._id || order.product_id || null,
      code: order.product_code || order.product_id?.code || '',
      name: order.product_name || order.product_id?.name || '',
      image_urls: order.product_id?.image_urls || [],
    },
    seller: seller?._id ? { id: seller._id, name: seller.name || '', city: seller.city || '', state: seller.state || '' } : null,
    customer: {
      name: order.customer_name || '',
      mobile: order.customer_mobile || '',
      email: order.customer_email || '',
      address: order.delivery_address || order.location || '',
    },
    // Who created/sent this order (the retailer business + person + contact).
    created_by: {
      name: order.created_by_person || order.created_by_name || '',
      company: order.created_by_company || (order.buyer_company_id && order.buyer_company_id.name) || '',
      mobile: order.created_by_mobile || (order.buyer_company_id && order.buyer_company_id.mobile) || '',
      email: order.created_by_email || (order.buyer_company_id && order.buyer_company_id.email) || '',
      type: order.created_by_type || (order.buyer_company_id ? 'Retailer App' : 'Admin'),
      label: order.created_by_name || '',
    },
    qty: order.qty,
    unit: order.unit,
    unit_price: order.rate,
    amount: order.amount,
    gst_percent: order.gst_percent,
    gst_amount: order.gst_amount,
    charges: { transport: order.transport_cost || 0, packing: order.packing_cost || 0, other: order.other_cost || 0 },
    total_amount: order.total_amount,
    packed_qty: order.packed_qty || 0,
    dispatched_qty: order.dispatched_qty || 0,
    remaining_qty: Math.max(0, (Number(order.qty) || 0) - (Number(order.dispatched_qty) || 0)),
    delivery_address: order.delivery_address || '',
    invoice_number: order.invoice_number || '',
    invoice_date: order.invoice_date,
    status_history: (order.status_history || []).map(item => ({
      status: ANDROID_STATUS[item.status] || 'Packing',
      internal_status: item.status,
      remarks: item.remarks || '',
      timestamp: item.timestamp,
    })),
    created_at: order.created_at,
    updated_at: order.updated_at,
  }
}

// Enquiries the retailer RAISED (it is the buyer). Used for cancel, which must
// never reach an enquiry that was merely SENT to the retailer.
function buyerEnquiryQuery(req, id = null) {
  const query = { buyer_company_id: req.user.company_id, buyer_user_id: req.user._id }
  if (id) query._id = id
  return query
}

// Everything the retailer can SEE: the enquiries it raised, PLUS the ones sent
// TO it (an Admin broadcast addressed to all retailers). Without the second
// clause a broadcast is invisible to the very retailers it was addressed to —
// `buyerEnquiryQuery` only matches rows where the retailer is the buyer.
// `$and` keeps the ownership `$or` from being clobbered by a caller that also
// sets `$or` (e.g. the search filter in listEnquiries).
function myEnquiryQuery(req, id = null) {
  const and = [{
    $or: [
      { buyer_company_id: req.user.company_id, buyer_user_id: req.user._id },
      { company_id: req.user.company_id },
    ],
  }]
  if (id) and.push({ _id: id })
  return { $and: and }
}

function buyerOrderQuery(req, id = null) {
  const query = { buyer_company_id: req.user.company_id, buyer_user_id: req.user._id }
  if (id) query._id = id
  return query
}

async function stockMap(productIds) {
  if (!productIds.length) return new Map()
  const rows = await Inventory.aggregate([
    { $match: { product_id: { $in: productIds } } },
    { $group: { _id: '$product_id', stock: { $sum: '$current_stock' } } },
  ])
  return new Map(rows.map(row => [row._id.toString(), Math.max(row.stock || 0, 0)]))
}

async function getCatalogueProduct(id, req = null) {
  if (!isObjectId(id)) return null
  const accessClause = req ? await buildAccessClause(req) : {}
  return Product.findOne({ _id: id, ...CATALOG_PRODUCT_QUERY, ...accessClause })
    .select(PRODUCT_SELECT)
    .populate('company_id', 'company_code name city state status is_active biz_type')
    .populate('brand_id', 'name code')
    .populate('category_id', 'name code')
    .populate('sub_category_id', 'name code')
    .lean()
}

async function getEnquiryProduct(id) {
  const product = await getCatalogueProduct(id)
  if (!product || !product.company_id) return null
  // Admin products bypass seller approval; third-party sellers must be vetted.
  if (!isEnquirableProduct(product)) return null
  return product
}

async function dashboard(req, res) {
  const orderScope = buyerOrderQuery(req)
  const invoiceOrderIds = await Order.find(orderScope).select('_id').lean().then(list => list.map(o => o._id))
  const [enquiries, orders, delivered, inProgress, unread, recentOrders, invoiceAgg] = await Promise.all([
    Enquiry.countDocuments(buyerEnquiryQuery(req)),
    Order.countDocuments(orderScope),
    Order.countDocuments({ ...orderScope, status: 'Delivered' }),
    Order.countDocuments({ ...orderScope, status: { $nin: ['Delivered', 'Cancelled'] } }),
    Notification.countDocuments({ company_id: req.user.company_id, user_id: req.user._id, is_read: false }),
    Order.find(orderScope).select('-purchase_rate -purchase_cost -warehouse_status').populate('seller_company_id', 'name city state').populate('product_id', 'code name image_urls').sort({ created_at: -1 }).limit(5).lean(),
    invoiceOrderIds.length
      ? Invoice.aggregate([
          { $match: { order_id: { $in: invoiceOrderIds } } },
          { $group: { _id: null, count: { $sum: 1 }, dueCount: { $sum: { $cond: [{ $gt: ['$balance_due', 0] }, 1, 0] } }, dueAmount: { $sum: '$balance_due' } } },
        ]).catch(() => [])
      : [],
  ])
  const inv = (invoiceAgg && invoiceAgg[0]) || { count: 0, dueCount: 0, dueAmount: 0 }
  return ok(res, {
    counts: {
      enquiries, orders, delivered, in_progress: inProgress,
      unread_notifications: unread,
      invoices: inv.count || 0,
      pending_payments: inv.dueCount || 0,
      pending_amount: inv.dueAmount || 0,
    },
    recent_orders: recentOrders.map(orderResponse),
    company_status: req.company.status,
  })
}

async function listProducts(req, res) {
  const { page, limit, skip } = parsePagination(req.query)
  let sellerIds = null

  // Location is an optional browse filter. Without it, do not pre-filter by
  // company approval so every active catalogue product can be displayed.
  if (req.query.location) {
    const location = new RegExp(escapeRegex(req.query.location), 'i')
    sellerIds = await Company.find({
      $or: [{ city: location }, { state: location }, { address: location }],
    }).distinct('_id')
    if (!sellerIds.length) {
      const pagination = paginate(0, page, limit)
      return ok(res, { products: [], pagination }, 'Products retrieved.', 200, pagination)
    }
  }

  const companyScope = sellerIds ? { company_id: { $in: sellerIds } } : {}
  const query = { ...CATALOG_PRODUCT_QUERY, ...companyScope }
  const search = String(req.query.search || '').trim()
  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i')
    const [brandIds, categoryIds] = await Promise.all([
      Brand.find({ ...companyScope, $or: [{ name: regex }, { code: regex }] }).distinct('_id'),
      Category.find({ ...companyScope, $or: [{ name: regex }, { code: regex }] }).distinct('_id'),
    ])
    query.$or = [
      { code: regex }, { name: regex }, { alias: regex }, { design: regex }, { description: regex },
      { size: regex }, { finish: regex }, { color: regex }, { material: regex }, { surface: regex },
      { tile_type: regex }, { application: regex }, { manufacturer: regex }, { collection: regex },
      { brand_id: { $in: brandIds } }, { category_id: { $in: categoryIds } }, { sub_category_id: { $in: categoryIds } },
    ]
  }
  for (const field of ['code', 'design', 'size', 'finish', 'color', 'material', 'tile_type', 'application', 'manufacturer', 'collection']) {
    if (req.query[field]) query[field] = new RegExp(escapeRegex(req.query[field]), 'i')
  }
  if (req.query.featured === 'true') query.featured = true
  if (req.query.new_arrival === 'true') query.new_arrival = true

  if (req.query.category) {
    const value = String(req.query.category)
    const categoryIds = isObjectId(value)
      ? [value]
      : await Category.find({ ...companyScope, $or: [{ name: new RegExp(escapeRegex(value), 'i') }, { code: new RegExp(escapeRegex(value), 'i') }] }).distinct('_id')
    query.category_id = { $in: categoryIds }
  }
  if (req.query.brand) {
    const value = String(req.query.brand)
    const brandIds = isObjectId(value)
      ? [value]
      : await Brand.find({ ...companyScope, $or: [{ name: new RegExp(escapeRegex(value), 'i') }, { code: new RegExp(escapeRegex(value), 'i') }] }).distinct('_id')
    query.brand_id = { $in: brandIds }
  }
  if (req.query.sub_category) {
    const value = String(req.query.sub_category)
    const categoryIds = isObjectId(value)
      ? [value]
      : await Category.find({
        ...companyScope,
        parent_id: { $ne: null },
        $or: [{ name: new RegExp(escapeRegex(value), 'i') }, { code: new RegExp(escapeRegex(value), 'i') }],
      }).distinct('_id')
    query.sub_category_id = { $in: categoryIds }
  }

  // Per-company access control for admin products (combine with any search $or).
  const accessClause = await buildAccessClause(req)
  query.$and = [...(query.$and || []), accessClause]

  // catalog_only=true → ONLY genuine Admin-created catalog products.
  // (source can be 'admin' for Retailer-created items too, so gate on the
  // authoritative created_by_type field instead of source.)
  if (String(req.query.catalog_only) === 'true') query.created_by_type = 'Admin'
  // mine=true → only THIS caller's own wholesaler products.
  if (String(req.query.mine) === 'true') {
    query.source = 'wholesaler'
    if (req.user.company_id) query.company_id = req.user.company_id
  }

  const [total, products] = await Promise.all([
    Product.countDocuments(query),
    Product.find(query).select(PRODUCT_SELECT)
      .populate('company_id', 'company_code name city state status is_active biz_type')
      .populate('brand_id', 'name code')
      .populate('category_id', 'name code')
      .populate('sub_category_id', 'name code')
      .sort({ featured: -1, new_arrival: -1, created_at: -1 })
      .skip(skip).limit(limit).lean(),
  ])
  const stocks = await stockMap(products.map(product => product._id))
  const pagination = paginate(total, page, limit)
  return ok(res, {
    products: products.map(product => productResponse(product, stocks.get(product._id.toString()), req.user)),
    pagination,
  }, 'Products retrieved.', 200, pagination)
}

async function getProduct(req, res) {
  const product = await getCatalogueProduct(req.params.id, req)
  if (!product) return sendError(res, 'Product not found or unavailable.', 404)
  const stocks = await stockMap([product._id])
  return ok(res, productResponse(product, stocks.get(product._id.toString()), req.user), 'Product retrieved.')
}

// GET /api/retailer/products/filters
// Distinct spec values across the catalogue the retailer can actually browse,
// so the filter sheet offers every real option instead of sampling the first
// page. Mirrors wholesalerProductController.getFilters.
// NOTE: must stay registered BEFORE `/products/:id` (see the route-ordering note
// in the routes file) or ':id' swallows 'filters'.
async function getProductFilters(req, res) {
  // Same visibility window as listProducts, so the options always describe the
  // set of products the caller can actually see.
  const query = { ...CATALOG_PRODUCT_QUERY }
  const accessClause = await buildAccessClause(req)
  query.$and = [...(query.$and || []), accessClause]

  const distinct = (field) =>
    Product.distinct(field, { ...query, [field]: { $nin: ['', null] } })

  const [sizes, finishes, materials, colors] = await Promise.all([
    distinct('size'), distinct('finish'), distinct('material'), distinct('color'),
  ])

  return ok(res, {
    sizes: sizes.filter(Boolean).sort(),
    finishes: finishes.filter(Boolean).sort(),
    materials: materials.filter(Boolean).sort(),
    colors: colors.filter(Boolean).sort(),
  }, 'Filters retrieved.')
}

// Resolve the company whose customers the retailer works with. Retailers see
// the ADMIN's customers (products are Admin-owned), so:
//   1. If the app passes a specific company_id, use it (must be a real company).
//   2. Otherwise resolve the Admin company = the Super Admin user's company.
// This lets the retailer app just ask for "the customers" without needing to
// know which company owns the product.
let cachedAdminCompanyId = null
async function resolveAdminCompanyId() {
  if (cachedAdminCompanyId) return cachedAdminCompanyId
  const superAdmin = await User.findOne({ role: 'Super Admin' }).select('company_id').lean()
  cachedAdminCompanyId = superAdmin?.company_id ? String(superAdmin.company_id) : null
  return cachedAdminCompanyId
}

async function resolveCustomerCompanyId(req) {
  const requested = req.query.company_id || req.body?.company_id
  if (requested) {
    if (!isObjectId(requested)) return null
    const exists = await Company.exists({ _id: requested })
    if (exists) return String(requested)
  }
  // No (valid) company passed → fall back to the Admin company.
  return await resolveAdminCompanyId()
}

function customerResponse(customer) {
  return {
    id: customer._id,
    name: customer.name || '',
    mobile: customer.mobile || '',
    email: customer.email || '',
    gst_number: customer.gst_number || '',
    address: customer.address || '',
    city: customer.city || '',
    state: customer.state || '',
    pincode: customer.pincode || '',
    biz_type: customer.biz_type || '',
    created_by_type: customer.created_by_type || '',
    created_by_name: customer.created_by_name || '',
    created_at: customer.created_at,
  }
}

// GET /api/retailer/customers?company_id=<owner company> — customer dropdown.
// Returns only customers added by THIS retailer (created_by_type = 'Retailer App'
// AND created_by = current user). Other companies' customers are never shown.
async function listRetailerCustomers(req, res) {
  const companyId = await resolveCustomerCompanyId(req)
  if (!companyId) return sendError(res, 'A valid company is required to load customers.', 400)

  const { page, limit, skip } = parsePagination(req.query, 50)

  // Only show customers this retailer added — never show Admin/Staff customers
  const query = {
    company_id: companyId,
    created_by_type: 'Retailer App',
    created_by: req.user._id || req.user.id,
  }
  const search = String(req.query.search || '').trim()
  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i')
    query.$or = [{ name: regex }, { mobile: regex }, { city: regex }]
  }
  const [total, customers] = await Promise.all([
    Customer.countDocuments(query),
    Customer.find(query).sort({ name: 1 }).skip(skip).limit(limit).lean(),
  ])
  return ok(res, { customers: customers.map(customerResponse) }, 'Customers retrieved.', 200, paginate(total, page, limit))
}

// POST /api/retailer/customers — add a customer to the owner (admin) company
// from the retailer app; tagged as sourced from the Retailer App.
async function createRetailerCustomer(req, res) {
  const companyId = await resolveCustomerCompanyId(req)
  if (!companyId) return sendError(res, 'A valid company is required to add a customer.', 400)

  const name = String(req.body.name || '').trim()
  const mobile = String(req.body.mobile || '').trim()
  if (!name) return sendError(res, 'Customer name is required.', 400)
  if (!/^\d{10}$/.test(mobile)) return sendError(res, 'A valid 10-digit mobile is required.', 400)

  // Avoid duplicates by mobile within the same company.
  const existing = await Customer.findOne({ company_id: companyId, mobile }).lean()
  if (existing) return ok(res, customerResponse(existing), 'Customer already exists.', 200)

  const customer = await Customer.create({
    company_id: companyId,
    name,
    mobile,
    email: String(req.body.email || '').trim(),
    gst_number: String(req.body.gst_number || '').trim().toUpperCase(),
    address: String(req.body.address || '').trim(),
    city: String(req.body.city || '').trim(),
    state: String(req.body.state || '').trim(),
    pincode: String(req.body.pincode || '').trim(),
    biz_type: String(req.body.biz_type || 'Retailer'),
    created_by: req.user._id || req.user.id || null,
    // Prefer the retailer business name; append the person's name when it adds
    // clarity, e.g. "ABC Traders (Ramesh)".
    created_by_name: (() => {
      const companyName = req.company?.name || ''
      const userName = req.user?.name || ''
      if (companyName && userName && companyName !== userName) return `${companyName} (${userName})`
      return companyName || userName || 'Retailer'
    })(),
    created_by_type: 'Retailer App',
  })
  return ok(res, customerResponse(customer), 'Customer added.', 201)
}

// A retailer may only edit/delete customers they added themselves from the
// Retailer App (not Admin- or Staff-created ones). Ownership is by created_by.
async function findRetailerOwnedCustomer(req) {
  const companyId = await resolveCustomerCompanyId(req)
  if (!companyId || !isObjectId(req.params.id)) return null
  return Customer.findOne({
    _id: req.params.id,
    company_id: companyId,
    created_by: req.user._id || req.user.id,
    created_by_type: 'Retailer App',
  })
}

// PUT /api/retailer/customers/:id
async function updateRetailerCustomer(req, res) {
  const existing = await findRetailerOwnedCustomer(req)
  if (!existing) return sendError(res, 'You can only edit customers you added from this app.', 403)

  const name = req.body.name !== undefined ? String(req.body.name).trim() : existing.name
  const mobile = req.body.mobile !== undefined ? String(req.body.mobile).trim() : existing.mobile
  if (!name) return sendError(res, 'Customer name is required.', 400)
  if (!/^\d{10}$/.test(mobile)) return sendError(res, 'A valid 10-digit mobile is required.', 400)

  const set = (field, transform = v => v) => {
    if (req.body[field] !== undefined) existing[field] = transform(String(req.body[field]))
  }
  existing.name = name
  existing.mobile = mobile
  set('email', v => v.trim())
  set('gst_number', v => v.trim().toUpperCase())
  set('address', v => v.trim())
  set('city', v => v.trim())
  set('state', v => v.trim())
  set('pincode', v => v.trim())
  await existing.save()
  return ok(res, customerResponse(existing.toObject()), 'Customer updated.')
}

// DELETE /api/retailer/customers/:id
async function deleteRetailerCustomer(req, res) {
  const existing = await findRetailerOwnedCustomer(req)
  if (!existing) return sendError(res, 'You can only delete customers you added from this app.', 403)
  await Customer.deleteOne({ _id: existing._id })
  return ok(res, { deleted: true }, 'Customer deleted.')
}

// Build and persist a Quotation for the Admin company from a retailer's enquiry
// on an Admin-owned product. The quotation shows up in the CRM Quotation
// Manager (GET /api/quotations is scoped to company_id = the Admin's company).
async function createAdminQuotationFromEnquiry(req, res, { product, qty, company }) {
  const body = req.body || {}
  const num = (v, d = 0) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : d
  }

  const seller = product.company_id || {}
  let customer = body.customer || {}

  // When a saved customer is selected in the app, use its authoritative details
  // (and confirm it belongs to the same owner company).
  if (body.customer_id && isObjectId(body.customer_id)) {
    const saved = await Customer.findOne({ _id: body.customer_id, company_id: seller._id }).lean()
    if (saved) {
      customer = {
        id: saved._id,
        name: saved.name,
        mobile: saved.mobile,
        email: saved.email,
        gst: saved.gst_number,
      }
    }
  }

  // Rate falls back to the product's retail price, then MRP.
  const rate = num(body.rate, num(product.retail_price, num(product.mrp, 0)))
  const discount = num(body.discount, 0)
  const gstPercent = body.gst_percent !== undefined ? num(body.gst_percent, product.gst_percent || 0) : num(product.gst_percent, 0)

  const amount = money(qty * rate)
  const taxable = money(Math.max(0, amount - discount))
  const gstAmount = money(taxable * gstPercent / 100)
  const itemTotal = money(taxable + gstAmount)
  const freight = num(body.freight_charges, 0)
  const other = num(body.other_charges, 0)
  const grandTotal = money(itemTotal + freight + other)

  const item = {
    product_id: product._id,
    product_name: product.name || '',
    product_code: product.code || '',
    brand_name: product.brand_id?.name || '',
    category_name: product.category_id?.name || '',
    sub_category_name: product.sub_category_id?.name || '',
    size: product.size || '',
    finish: product.finish || '',
    tile_type: product.tile_type || '',
    grade: product.grade || '',
    color: product.color || '',
    hsn_code: product.hsn_code || '',
    unit: body.unit || product.unit || 'Box',
    gst_percent: gstPercent,
    mrp: num(product.mrp, 0),
    retail_price: num(product.retail_price, 0),
    dealer_price: num(product.dealer_price, 0),
    purchase_price: num(product.purchase_price, 0),
    pcs_per_box: product.pcs_per_box ?? null,
    sqft_per_box: product.sqft_per_box ?? null,
    qty,
    rate,
    disc: discount,
    total: itemTotal,
  }

  // Sequential quotation number scoped to the Admin's company.
  const last = await Quotation.findOne({ company_id: seller._id, quotation_no: /^QT-/ }).sort({ created_at: -1 }).lean()
  const lastNum = last?.quotation_no ? parseInt(last.quotation_no.split('-')[1], 10) : 0
  const quotationNo = `QT-${String((Number.isFinite(lastNum) ? lastNum : 0) + 1).padStart(4, '0')}`
  const enquiryRef = `ENQ-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}-${crypto.randomInt(100, 999)}`

  const quotation = await Quotation.create({
    company_id: seller._id,
    quotation_no: quotationNo,
    enquiry_no: enquiryRef,
    // Retailer marketplace origin so an accepted quotation can create a
    // retailer-visible order + notify the retailer.
    buyer_company_id: req.user.company_id,
    buyer_user_id: req.user._id,
    source: 'Retailer App',
    // The retailer business + person who created this quotation (so admin can
    // tell which retailer among many submitted it).
    created_by_name: `${company?.name || 'Retailer'}${req.user?.name ? ` (${req.user.name})` : ''}`,
    created_by_company: (company?.name || '').trim(),
    created_by_person: (req.user?.name || '').trim(),
    created_by_mobile: (req.user?.mobile || company?.mobile || '').trim(),
    created_by_email: (req.user?.email || company?.email || '').trim(),
    created_by_type: 'Retailer App',
    customer_name: (customer.name || company.name || '').trim(),
    customer_phone: (customer.mobile || req.user.mobile || company.mobile || '').trim(),
    customer_email: (customer.email || req.user.email || company.email || '').trim(),
    delivery_no: String(body.location || '').trim(),
    quotation_date: new Date(),
    items: [item],
    freight_charges: freight,
    other_charges: other,
    subtotal: taxable,
    gst_amount: gstAmount,
    grand_total: grandTotal,
    remarks: String(body.remarks || '').trim().slice(0, 2000),
    status: 'sent',
    created_by: req.user._id,
  })

  // Also create a marketplace Enquiry so the retailer sees this request in the
  // app's "My Enquiries" tab (listEnquiries filters by buyer ids).
  const enquiryDoc = await Enquiry.create({
    enq_code: enquiryRef,
    company_id: seller._id,
    buyer_company_id: req.user.company_id,
    buyer_user_id: req.user._id,
    seller_company_id: seller._id,
    retailer_name: (company?.name || req.user.name || 'Retailer').trim(),
    retailer_mobile: req.user.mobile || company?.mobile || '',
    retailer_email: req.user.email || company?.email || '',
    location: String(body.location || '').trim(),
    product_id: product._id,
    product_code: product.code,
    product_name: product.name,
    qty,
    unit: item.unit || 'Pcs',
    offered_price: rate,
    remarks: String(body.remarks || '').trim().slice(0, 2000),
    created_by: req.user._id,
    status: 'New',
  })
  console.log('[createAdminQuotationFromEnquiry] Enquiry created', {
    enquiry_id: String(enquiryDoc._id),
    buyer_company_id: String(enquiryDoc.buyer_company_id),
    buyer_user_id: String(enquiryDoc.buyer_user_id),
    status: enquiryDoc.status,
  })
  await Quotation.updateOne({ _id: quotation._id }, { enquiry_id: enquiryDoc._id }).catch(() => {})

  // Notify the Admin company so the incoming quotation is visible in-app too.
  await Notification.create({
    company_id: seller._id,
    type: 'retailer_quotation',
    title: `New quotation request ${quotationNo}`,
    message: `${company.name} requested a quotation for ${product.name} × ${qty} ${item.unit}`,
    reference_id: quotation._id,
  }).catch(() => {})

  // Confirmation notification to the retailer so it appears in their app.
  await Notification.create({
    company_id: req.user.company_id,
    user_id: req.user._id,
    type: 'enquiry_created',
    title: 'Enquiry sent',
    message: `Your quotation request for ${product.name} × ${qty} ${item.unit} was sent.`,
    reference_id: enquiryDoc?._id || quotation._id,
  }).catch(() => {})
  if (seller.owner_user_id) {
    notifySeller(seller.owner_user_id, {
      title: `New Quotation Request ${quotationNo}`,
      body: `${company.name} requested ${product.name} × ${qty} ${item.unit}`,
      type: 'retailer_quotation',
      referenceId: quotation._id,
    })
  }

  // Shape the response so the retailer app's success screen works unchanged
  // (it reads `enquiry_code` / `id`). Return the Enquiry id so the app can open
  // it from the Enquiries list.
  return ok(res, {
    id: enquiryDoc?._id || quotation._id,
    enquiry_code: enquiryRef,
    quotation_no: quotationNo,
    status: enquiryDoc?.status || quotation.status,
    grand_total: grandTotal,
    product: { id: product._id, code: product.code, name: product.name, image_urls: product.image_urls || [] },
    created_at: quotation.created_at,
  }, 'Enquiry sent.', 201)
}

// ── Free-text enquiry (no catalogue product) — BROADCAST ─────────────────────
// The retailer app's simple enquiry form lets the retailer DESCRIBE the product
// in plain words (name / category / brand / size / finish / colour / grade /
// details) instead of picking a catalogue item.
//
// There is no product, so there is no single owning seller to route to. The
// retailer's instruction was explicit:
//
//   > "if i sent the enquery it should be go all wholealer , admin also create
//   >  in admin also inside market maagement they will give reply"
//
// So this FANS OUT: one Enquiry document per recipient — every approved, active
// wholesaler company plus the Admin company. The `Enquiry` schema carries a
// single `company_id` / `seller_company_id`, so a broadcast is N rows, not one
// shared row; every copy carries the same `enq_code` so they read as one
// broadcast, and each copy keeps `buyer_company_id` / `buyer_user_id` so the
// retailer sees every thread and every reply that comes back.
//
// Replies: each recipient answers on ITS OWN copy, so quotes arrive as separate
// threads the retailer can compare. Recipients quote via
// `POST /api/enquiries/:id/offers` (sellerCreateOffer) or the CRM's
// Market Management reply (PATCH /api/enquiries/:id → updateEnquiry) — both were
// relaxed the same day so that a product-less enquiry is answerable.
async function createFreeTextEnquiry(req, res) {
  const company = req.company
  const body = req.body || {}

  const productName = String(body.product_name || '').trim()
  if (!productName) return sendError(res, 'Product name is required.', 400)

  const qty = Number(body.qty)
  if (!Number.isFinite(qty) || qty <= 0) return sendError(res, 'qty must be greater than zero.', 400)

  // ── Recipients: every approved active wholesaler + ALL OTHER retailers + Admin ──
  // biz_type is free text, so match on the STEM substring, case-insensitively.
  // `/^wholesalers?$/i` used to silently drop a real "Wholesale" company (seen in
  // production) — a wholesaler never received the retailer's broadcast.
  const adminCompanyId = await resolveAdminCompanyId()
  const wholesalers = await Company.find({
    biz_type: /wholesale/i,
    status: 'Approved',
    is_active: { $ne: false },
  }).select('_id owner_user_id name').lean()

  // Every OTHER retailer company (the sender itself is excluded by the `seen`
  // set seeded below). The enquiry must reach fellow retailers too, not just
  // wholesalers and Admin.
  const retailers = await Company.find({
    biz_type: /retail/i,
    status: 'Approved',
    is_active: { $ne: false },
  }).select('_id owner_user_id name').lean()

  const recipients = []
  // Seed with the sender so the retailer can never broadcast to itself.
  const seen = new Set([String(req.user.company_id)])
  if (adminCompanyId && !seen.has(String(adminCompanyId))) {
    recipients.push(String(adminCompanyId)); seen.add(String(adminCompanyId))
  }
  for (const w of wholesalers) {
    const id = String(w._id)
    if (seen.has(id)) continue
    seen.add(id)
    recipients.push(id)
  }
  // Add fellow retailers (sender already in `seen`, so it's skipped).
  for (const r of retailers) {
    const id = String(r._id)
    if (seen.has(id)) continue
    seen.add(id)
    recipients.push(id)
  }
  if (!recipients.length) return sendError(res, 'No wholesaler, retailer or Admin company is available to receive enquiries.', 409)

  // The Enquiry model has no dedicated category/brand/size/… columns, so the
  // retailer's free-text description is composed into `remarks` — which is what
  // the CRM's Market Management row shows (`enqRemarks`) and what the retailer
  // sees on its detail screen. Keep the labels so the block stays readable.
  const remarks = [
    body.category ? `Category: ${String(body.category).trim()}`     : '',
    body.brand    ? `Brand: ${String(body.brand).trim()}`           : '',
    body.size     ? `Size: ${String(body.size).trim()}`             : '',
    body.finish   ? `Finish: ${String(body.finish).trim()}`         : '',
    body.colour   ? `Colour: ${String(body.colour).trim()}`         : '',
    body.material ? `Material: ${String(body.material).trim()}`     : '',
    body.surface  ? `Surface: ${String(body.surface).trim()}`       : '',
    body.grade    ? `Grade: ${String(body.grade).trim()}`           : '',
    body.thickness ? `Thickness: ${String(body.thickness).trim()}` : '',
    body.tile_type ? `Tile Type: ${String(body.tile_type).trim()}` : '',
    body.details  ? `Details: ${String(body.details).trim()}`       : '',
    body.remarks  ? `Notes: ${String(body.remarks).trim()}`         : '',
  ].filter(Boolean).join('\n').slice(0, 2000)

  // A DISTINCT PREFIX ('REQ-', not 'ENQ-') is deliberate. listEnquiries sweeps
  // away every enquiry whose code starts with 'ENQ-' that has no matching
  // Quotation — so an 'ENQ-' free-text enquiry would be created and then
  // instantly hidden from the retailer's own list. 'REQ-' is never swept.
  const enqCode = `REQ-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}-${crypto.randomInt(100, 999)}`
  const unit = String(body.unit || 'Pcs').trim() || 'Pcs'

  const base = {
    enq_code: enqCode,
    buyer_company_id: req.user.company_id,
    buyer_user_id: req.user._id,
    retailer_name: (company?.name || req.user.name || 'Retailer').trim(),
    retailer_mobile: req.user.mobile || company?.mobile || '',
    retailer_email: req.user.email || company?.email || '',
    location: String(body.location || company?.city || '').trim(),
    product_id: null,
    product_code: '',
    product_name: productName.slice(0, 200),
    qty,
    unit,
    remarks,
    // Stamped so the Admin's CRM can label this as a broadcast it RECEIVED
    // ("BROADCAST · wholesalers") rather than mistaking it for a 1:1 enquiry.
    // The value is the RETAILER's company, so the Admin's own
    // `broadcast_owner_company_id` OR-clause never matches it.
    broadcast_owner_company_id: req.user.company_id,
    broadcast_audience: 'both',
    created_by: req.user._id,
    status: 'New',
  }

  // One row per recipient, inserted in a single round trip.
  const docs = await Enquiry.insertMany(
    recipients.map(companyId => ({ ...base, company_id: companyId, seller_company_id: companyId })),
  )

  // One in-app notification per recipient company (so it shows in the wholesaler
  // app's and the CRM's notification lists) + one push to each owner user.
  await Promise.all(docs.map(doc => Notification.create({
    company_id: doc.company_id,
    type: 'retailer_enquiry',
    title: `New retailer enquiry ${enqCode}`,
    message: `${company?.name || 'A retailer'} enquired for ${productName} × ${qty} ${unit}`,
    reference_id: doc._id,
  }).catch(() => {})))

  const ownerIds = [
    ...(await Company.find({ _id: { $in: recipients } }).select('owner_user_id').lean())
      .map(c => c.owner_user_id)
      .filter(Boolean),
  ]
  for (const ownerId of ownerIds) {
    notifySeller(ownerId, {
      title: `New Enquiry ${enqCode}`,
      body: `${company?.name || 'A retailer'} enquired for ${productName} × ${qty} ${unit}`,
      type: 'retailer_enquiry',
      referenceId: docs[0]._id,
    })
  }

  // ONE confirmation to the retailer — not one per recipient, or a broadcast to
  // 20 wholesalers would spam the retailer's notification list 20 times.
  const adminDoc = docs.find(d => String(d.company_id) === String(adminCompanyId)) || docs[0]
  await Notification.create({
    company_id: req.user.company_id, user_id: req.user._id,
    type: 'enquiry_created', title: 'Enquiry submitted',
    message: `${enqCode} was sent to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'} (wholesalers, retailers and the Admin team).`,
    reference_id: adminDoc._id,
  }).catch(() => {})

  // Return the Admin copy (the primary responder) so the app opens a real thread.
  const result = await Enquiry.findById(adminDoc._id)
    .populate('seller_company_id', 'name city state')
    .populate('product_id', 'code name image_urls')
    .lean()
  const payload = enquiryResponse(result)
  payload.recipients = recipients.length
  return ok(res, payload, 'Enquiry created.', 201)
}

async function createEnquiry(req, res) {
  console.log('[createEnquiry] incoming', {
    product_id: req.body.product_id,
    buyer_company_id: String(req.user?.company_id),
    buyer_user_id: String(req.user?._id),
  })

  // No catalogue product → the retailer typed the product details instead.
  if (!req.body.product_id) {
    return createFreeTextEnquiry(req, res)
  }

  const productId = req.body.product_id
  if (!productId) return sendError(res, 'product_id is required.', 400)
  if (!isObjectId(productId)) return sendError(res, `Invalid product id: ${productId}`, 400)
  const catalogueProduct = await getCatalogueProduct(productId)
  if (!catalogueProduct) return sendError(res, 'Product not found (it may be inactive or deleted).', 404)
  if (catalogueProduct.online_visible === false) return sendError(res, 'Product is not visible online.', 409)
  const product = catalogueProduct

  // Resolve the owner company id even if the populated company doc is missing
  // (e.g. the company was removed). For Admin products, fall back to the Admin
  // company so the quotation still routes correctly.
  const rawOwnerId = product.company_id?._id || product.company_id || null
  let ownerCompanyId = rawOwnerId
  if (!ownerCompanyId && String(product.created_by_type || '') === 'Admin') {
    ownerCompanyId = await resolveAdminCompanyId()
  }
  if (!ownerCompanyId) {
    // Last resort: read the unpopulated company_id straight off the product doc.
    const rawProduct = await Product.findById(productId).select('company_id').lean()
    ownerCompanyId = rawProduct?.company_id || null
  }
  if (!ownerCompanyId) return sendError(res, 'Product owner company could not be resolved.', 404)

  // Normalise so downstream code (createAdminQuotationFromEnquiry) always has
  // a usable company_id with an _id.
  if (!product.company_id || !product.company_id._id) {
    product.company_id = { _id: ownerCompanyId, ...(product.company_id || {}) }
  }

  // A retailer cannot enquire on their own product; every other product is fine.
  if (String(ownerCompanyId) === String(req.user.company_id)) {
    return sendError(res, 'You cannot send an enquiry on your own product.', 409)
  }
  const qty = Number(req.body.qty)
  if (!Number.isFinite(qty) || qty <= 0) return sendError(res, 'qty must be greater than zero.', 400)

  const company = req.company

  // ── Admin products: a retailer "enquiry" is a Quotation request that lands
  // directly in the Admin's Finance → Quotation Manager, with full details. ──
  console.log('[createEnquiry] created_by_type =', product.created_by_type, '→',
    String(product.created_by_type || '') === 'Admin' ? 'ADMIN quotation path' : 'normal enquiry path')
  if (String(product.created_by_type || '') === 'Admin') {
    return createAdminQuotationFromEnquiry(req, res, { product, qty, company })
  }

  const enqCode = `ENQ-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}-${crypto.randomInt(100, 999)}`
  const enquiry = await Enquiry.create({
    enq_code: enqCode,
    company_id: product.company_id._id,
    buyer_company_id: req.user.company_id,
    buyer_user_id: req.user._id,
    seller_company_id: product.company_id._id,
    retailer_name: company.name,
    retailer_mobile: req.user.mobile || company.mobile || '',
    retailer_email: req.user.email || company.email || '',
    location: String(req.body.location || company.city || '').trim(),
    product_id: product._id,
    product_code: product.code,
    product_name: product.name,
    qty,
    unit: product.unit || 'Pcs',
    remarks: String(req.body.remarks || '').trim().slice(0, 2000),
    created_by: req.user._id,
    status: 'New',
  })

  await Promise.all([
    Notification.create({
      company_id: product.company_id._id,
      type: 'retailer_enquiry', title: `New retailer enquiry ${enqCode}`,
      message: `${company.name} enquired for ${product.name} × ${qty} ${product.unit || 'Pcs'}`,
      reference_id: enquiry._id,
    }),
    Notification.create({
      company_id: req.user.company_id, user_id: req.user._id,
      type: 'enquiry_created', title: 'Enquiry submitted',
      message: `${enqCode} was sent to ${product.company_id.name}.`, reference_id: enquiry._id,
    }),
  ])
  // Push notification to seller about new enquiry
  if (product.company_id.owner_user_id) {
    notifySeller(product.company_id.owner_user_id, {
      title: `New Enquiry ${enqCode}`,
      body: `${company.name} enquired for ${product.name} × ${qty} ${product.unit || 'Pcs'}`,
      type: 'retailer_enquiry',
      referenceId: enquiry._id,
    })
  }

  const result = await Enquiry.findById(enquiry._id).populate('seller_company_id', 'name city state').populate('product_id', 'code name image_urls').lean()
  return ok(res, enquiryResponse(result), 'Enquiry created.', 201)
}

async function listEnquiries(req, res) {
  const { page, limit, skip } = parsePagination(req.query)
  // myEnquiryQuery (not buyerEnquiryQuery): the retailer must also see enquiries
  // sent TO it, e.g. an Admin broadcast addressed to all retailers.
  const query = myEnquiryQuery(req)
  if (req.query.status && req.query.status !== 'All') {
    // Support comma-separated status values (e.g. "Viewed,Replied,Negotiation")
    const statuses = String(req.query.status).split(',').map(s => s.trim()).filter(Boolean)
    query.status = statuses.length === 1 ? statuses[0] : { $in: statuses }
  }
  if (req.query.search) {
    const regex = new RegExp(escapeRegex(req.query.search), 'i')
    // Must NOT assign to `query.$or` — myEnquiryQuery already uses `$and`, and a
    // top-level `$or` would be fine but a second one would clobber the first.
    query.$and = [...(query.$and || []), { $or: [{ enq_code: regex }, { product_name: regex }] }]
  }
  const [total, enquiries] = await Promise.all([
    Enquiry.countDocuments(query),
    Enquiry.find(query).populate('seller_company_id', 'name city state').populate('buyer_company_id', 'name city state').populate('product_id', 'code name image_urls').sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
  ])

  // Hide admin-product enquiries whose linked quotation was deleted, so a
  // quotation removed by the admin (or DB) no longer lingers in the app.
  const adminEnquiryCodes = enquiries
    .filter(e => typeof e.enq_code === 'string' && e.enq_code.startsWith('ENQ-'))
    .map(e => e.enq_code)
  let deletedCodes = new Set()
  if (adminEnquiryCodes.length) {
    const liveQuotations = await Quotation.find({ enquiry_no: { $in: adminEnquiryCodes } }).select('enquiry_no').lean().catch(() => [])
    const liveCodes = new Set(liveQuotations.map(q => q.enquiry_no))
    // Clean up orphans in the background so they don't reappear.
    for (const code of adminEnquiryCodes) {
      if (!liveCodes.has(code)) deletedCodes.add(code)
    }
    if (deletedCodes.size) {
      Enquiry.deleteMany({ enq_code: { $in: [...deletedCodes] }, buyer_company_id: req.user.company_id }).catch(() => {})
    }
  }
  const visible = enquiries.filter(e => !(e.enq_code && deletedCodes.has(e.enq_code)))

  return ok(res, {
    enquiries: visible.map(e => enquiryResponse(e, null, req.user.company_id)),
  }, 'Enquiries retrieved.', 200, paginate(total, page, limit))
}

async function getEnquiry(req, res) {
  if (!isObjectId(req.params.id)) return sendError(res, 'Enquiry not found.', 404)
  const enquiry = await Enquiry.findOne(myEnquiryQuery(req, req.params.id)).populate('seller_company_id', 'name city state').populate('buyer_company_id', 'name city state').populate('product_id', 'code name image_urls').lean()
  if (!enquiry) return sendError(res, 'Enquiry not found.', 404)
  // Attach the retailer's submitted quotation (rate/discount/GST/charges/total).
  const quotation = await Quotation.findOne({ enquiry_id: enquiry._id }).lean().catch(() => null)
  return ok(res, enquiryResponse(enquiry, quotation, req.user.company_id), 'Enquiry retrieved.')
}

// ── PATCH /api/retailer/enquiries/:id ────────────────────────────────────────
// The retailer's write path, and the twin of `enquiryController.updateEnquiry`.
// Until this existed there was NO `PATCH /retailer/enquiries/:id` route at all,
// so `enquiryService.reply` / `enquiryService.update` in the app — both of which
// hit exactly this path — were a silent 404. That meant the retailer could
// neither record a 'Viewed' status nor answer an enquiry sent to it.
//
// Two cases, decided by which side of the enquiry the company is on:
//   • RECEIVED (company_id === me) → the full availability + price reply.
//   • RAISED   (buyer_company_id === me) → status-only moves the app needs
//     ('Viewed' when the detail screen opens, 'Cancelled' to withdraw).
// A retailer can never use this to rewrite an enquiry it raised.
async function updateEnquiry(req, res) {
  if (!isObjectId(req.params.id)) return sendError(res, 'Enquiry not found.', 404)

  const body = req.body || {}

  // Three shapes: the enquiry was sent TO this retailer (company_id), or this
  // retailer SENT it (broadcast_owner_company_id / buyer_company_id).
  const received = await Enquiry.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean()
  const enquiry = received
    || await Enquiry.findOne({
        _id: req.params.id,
        $or: [
          { buyer_company_id: req.user.company_id },
          { broadcast_owner_company_id: req.user.company_id },
        ],
      }).lean()
  if (!enquiry) return sendError(res, 'Enquiry not found.', 404)

  const update = {}

  if (received) {
    // Recipient (seller) writing their availability + price reply
    if (body.available_quantity !== undefined && body.available_quantity !== '' && body.available_quantity !== null) {
      const n = Number(body.available_quantity)
      if (!Number.isFinite(n) || n < 0) return sendError(res, 'available_quantity must be zero or more.', 400)
      update.available_quantity = n
    }
    if (body.offered_price !== undefined && body.offered_price !== '' && body.offered_price !== null) {
      const n = Number(body.offered_price)
      if (!Number.isFinite(n) || n <= 0) return sendError(res, 'offered_price must be greater than zero.', 400)
      update.offered_price = n
    }
    if (body.delivery_timeline !== undefined) update.delivery_timeline = String(body.delivery_timeline).trim().slice(0, 100)
    if (body.distributor_reply !== undefined) update.distributor_reply = String(body.distributor_reply).trim().slice(0, 2000)

    const allowed = ['Viewed', 'Replied', 'Cancelled']
    if (body.status !== undefined && allowed.includes(body.status)) update.status = body.status
    else if (Object.keys(update).length) update.status = 'Replied'   // a reply implies "Replied"
  } else {
    // Buyer / broadcast owner updating a seller's row (counter-offer / negotiation)
    if (body.available_quantity !== undefined && body.available_quantity !== '' && body.available_quantity !== null) {
      update.available_quantity = Number(body.available_quantity)
    }
    if (body.offered_price !== undefined && body.offered_price !== '' && body.offered_price !== null) {
      update.offered_price = Number(body.offered_price)
    }
    if (body.delivery_timeline !== undefined) update.delivery_timeline = String(body.delivery_timeline || '').trim().slice(0, 100)
    if (body.distributor_reply !== undefined) update.distributor_reply = String(body.distributor_reply || '').trim().slice(0, 2000)
    if (body.negotiation_note !== undefined) update.negotiation_note = String(body.negotiation_note || '').trim()
    // Status moves allowed for buyer on their own broadcast rows
    const allowed = ['Viewed', 'Replied', 'Negotiation', 'Confirmed', 'Cancelled']
    if (body.status !== undefined && allowed.includes(body.status)) update.status = body.status
    else if (Object.keys(update).length && !update.status) update.status = 'Replied'
  }

  if (!Object.keys(update).length) return sendError(res, 'Nothing to update.', 400)

  const updated = await Enquiry.findByIdAndUpdate(enquiry._id, update, { new: true })
    .populate('seller_company_id', 'name city state')
    .populate('product_id', 'code name image_urls')
    .lean()

  // Tell the SENDER a reply came in (an Admin broadcast's sender is the Admin).
  if (received && update.status === 'Replied' && enquiry.buyer_company_id) {
    const price = update.offered_price ?? enquiry.offered_price
    const suffix = price ? ` — ₹${price} per ${enquiry.unit}` : ''
    await Notification.create({
      company_id: enquiry.buyer_company_id,
      type: 'enquiry_reply',
      title: `Reply for ${enquiry.enq_code}`,
      message: `${req.company?.name || 'A retailer'} replied${suffix}.`,
      reference_id: enquiry._id,
    }).catch(() => {})
    if (enquiry.buyer_user_id) {
      notifyRetailer(enquiry.buyer_user_id, {
        title: `Reply for ${enquiry.enq_code}`,
        body: `${req.company?.name || 'A retailer'} replied${suffix}.`,
        type: 'enquiry_reply',
        referenceId: enquiry._id,
      })
    }
  }

  return ok(res, enquiryResponse(updated, null, req.user.company_id), 'Enquiry updated.')
}

// ── GET /api/retailer/enquiries/:id/replies ──────────────────────────────────
// The retailer's twin of `enquiryController.enquiryReplies`. A broadcast is N
// sibling rows sharing one `enq_code`, so the sender wants the roster — who
// answered, what they quoted, and who is still silent — not N separate cards.
//
// NOTE this deliberately reads SIBLINGS the retailer does not own: the copies
// sent to wholesalers and to the Admin have `company_id` = those companies. The
// retailer is entitled to see them because it is the one who ASKED, which is why
// the anchor is resolved through `myEnquiryQuery` and the siblings are then
// fetched by `enq_code` alone.
function shapeReply(row) {
  const c = row.company_id && row.company_id._id ? row.company_id : null
  return {
    id: row._id,
    company: c ? {
      id: c._id,
      name: c.name || '',
      company_code: c.company_code || '',
      city: c.city || '',
      state: c.state || '',
      mobile: c.mobile || '',
    } : null,
    status: row.status,
    unit: row.unit || '',
    qty: row.qty,
    offered_price: row.offered_price ?? null,
    available_quantity: row.available_quantity ?? null,
    delivery_timeline: row.delivery_timeline || '',
    message: row.distributor_reply || '',
    responded_at: row.updated_at || null,
  }
}

function hasReplied(row) {
  return ['Replied', 'Negotiation', 'Confirmed'].includes(row.status)
    || !!String(row.distributor_reply || '').trim()
    || row.offered_price != null
    || row.available_quantity != null
}

async function enquiryReplies(req, res) {
  if (!isObjectId(req.params.id)) return sendError(res, 'Enquiry not found.', 404)
  const anchor = await Enquiry.findOne(myEnquiryQuery(req, req.params.id))
    .select('enq_code broadcast_owner_company_id').lean()
  if (!anchor) return sendError(res, 'Enquiry not found.', 404)

  // Conversation isolation for broadcasts:
  //   • The broadcast OWNER (sender) wants the whole roster — "3 of 5 replied",
  //     every recipient's quote — so it reads ALL siblings by `enq_code`.
  //   • A plain RECIPIENT must only ever see THEIR OWN reply, never the other
  //     recipients' quotes (a retailer must not see a wholesaler's price, and
  //     vice versa). So a recipient's roster is just their own row.
  const isBroadcastOwner = anchor.broadcast_owner_company_id
    && String(anchor.broadcast_owner_company_id) === String(req.user.company_id)
  const rows = (anchor.enq_code && isBroadcastOwner)
    ? await Enquiry.find({ enq_code: anchor.enq_code })
        .populate('company_id', 'name company_code city state mobile')
        .sort({ updated_at: -1 })
        .lean()
    : await Enquiry.find({ _id: anchor._id })
        .populate('company_id', 'name company_code city state mobile')
        .lean()

  const replied  = rows.filter(hasReplied).map(shapeReply)
  const awaiting = rows.filter(r => !hasReplied(r)).map(shapeReply)

  return ok(res, {
    enquiry_code: anchor.enq_code,
    total: rows.length,
    counts: { total: rows.length, replied: replied.length, awaiting: awaiting.length },
    replied,
    awaiting,
  }, 'Replies retrieved.')
}

async function cancelEnquiry(req, res) {
  if (!isObjectId(req.params.id)) return sendError(res, 'Enquiry not found.', 404)
  const enquiry = await Enquiry.findOneAndUpdate(
    { ...buyerEnquiryQuery(req, req.params.id), status: { $in: ['New', 'Viewed', 'Replied', 'Negotiation'] }, order_id: null },
    { status: 'Cancelled' },
    { new: true }
  ).populate('seller_company_id', 'name city state').populate('product_id', 'code name image_urls').lean()
  if (!enquiry) return sendError(res, 'Only an open enquiry without an order can be cancelled.', 409)
  await Notification.create({
    company_id: enquiry.seller_company_id._id || enquiry.seller_company_id,
    type: 'enquiry_cancelled', title: `Enquiry ${enquiry.enq_code} cancelled`,
    message: `${req.company.name} cancelled this enquiry.`, reference_id: enquiry._id,
  })
  // Push to seller about cancellation
  notifySeller(null, {
    title: `Enquiry ${enquiry.enq_code} Cancelled`,
    body: `${req.company.name} cancelled this enquiry.`,
    type: 'enquiry_cancelled',
    referenceId: enquiry._id,
  })
  return ok(res, enquiryResponse(enquiry), 'Enquiry cancelled.')
}

async function listMessages(req, res) {
  // Accept any row this user's company owns — as buyer, seller, or broadcast sender.
  const enquiry = await Enquiry.findOne({
    _id: req.params.id,
    $or: [
      { buyer_company_id: req.user.company_id },
      { broadcast_owner_company_id: req.user.company_id },
      { company_id: req.user.company_id },
    ],
  }).select('_id enq_code broadcast_owner_company_id').lean()
  if (!enquiry) return sendError(res, 'Enquiry not found.', 404)

  // Conversation isolation for broadcasts:
  //   • The broadcast OWNER (sender) sees the FULL thread across every recipient
  //     sibling — they are talking to all of them.
  //   • A plain RECIPIENT sees ONLY their own row's thread with the creator —
  //     NOT other recipients' conversations. Previously this expanded to every
  //     sibling by `enq_code` for anyone, so a retailer recipient saw the
  //     wholesaler recipient's messages (and vice versa).
  const isBroadcastOwner = enquiry.broadcast_owner_company_id
    && String(enquiry.broadcast_owner_company_id) === String(req.user.company_id)
  let rowIds = [enquiry._id]
  if (enquiry.enq_code && isBroadcastOwner) {
    const siblings = await Enquiry.find({ enq_code: enquiry.enq_code }).select('_id').lean()
    rowIds = siblings.map(s => s._id)
  }

  const messages = await EnquiryMessage.find({ enquiry_id: { $in: rowIds } })
    .populate('sender_user_id', 'name role')
    .sort({ created_at: 1 })
    .lean()
  return ok(res, { messages: messages.map(item => ({
    id: item._id, message: item.message, sender_side: item.sender_side,
    seller_company_id: item.seller_company_id,
    sender: item.sender_user_id ? { id: item.sender_user_id._id, name: item.sender_user_id.name } : null,
    client_message_id: item.client_message_id || '', created_at: item.created_at,
  })) }, 'Messages retrieved.')
}

async function createBuyerMessage(req, res) {
  const message = String(req.body.message || '').trim()
  const clientMessageId = String(req.body.client_message_id || '').trim()
  if (!message || message.length > 2000) return sendError(res, 'message is required and must not exceed 2000 characters.', 400)

  // Find the enquiry — buyer_company_id match is enough; don't require buyer_user_id
  // because any staff member from the buyer's company should be able to message.
  const enquiry = await Enquiry.findOne({
    _id: req.params.id,
    $or: [
      { buyer_company_id: req.user.company_id },
      { broadcast_owner_company_id: req.user.company_id },
      { company_id: req.user.company_id },
    ],
  }).lean()
  if (!enquiry) return sendError(res, 'Enquiry not found.', 404)
  if (enquiry.status === 'Cancelled') return sendError(res, 'Messages cannot be sent on a cancelled enquiry.', 409)

  if (clientMessageId) {
    const existing = await EnquiryMessage.findOne({ sender_user_id: req.user._id, client_message_id: clientMessageId }).lean()
    if (existing) return ok(res, existing, 'Message already received.')
  }
  const created = await EnquiryMessage.create({
    enquiry_id: enquiry._id, buyer_company_id: enquiry.buyer_company_id,
    buyer_user_id: enquiry.buyer_user_id, seller_company_id: enquiry.seller_company_id,
    sender_user_id: req.user._id, sender_side: 'buyer', message, client_message_id: clientMessageId,
  })
  const latestOffer = await EnquiryOffer.findOne({ enquiry_id: enquiry._id, seller_company_id: enquiry.seller_company_id }).sort({ created_at: -1 }).lean()
  await Notification.create({
    company_id: enquiry.seller_company_id, user_id: latestOffer?.seller_user_id || null,
    type: 'enquiry_message', title: `Message on ${enquiry.enq_code}`,
    message: `${req.user.name}: ${message.slice(0, 120)}`, reference_id: enquiry._id,
  })
  // Push notification to seller about new message
  if (latestOffer?.seller_user_id) {
    notifySeller(latestOffer.seller_user_id, {
      title: `Message on ${enquiry.enq_code}`,
      body: `${req.user.name}: ${message.slice(0, 100)}`,
      type: 'enquiry_message',
      referenceId: enquiry._id,
    })
  }
  return ok(res, created.toObject(), 'Message sent.', 201)
}

async function listOffers(req, res) {
  const enquiry = await Enquiry.findOne(buyerEnquiryQuery(req, req.params.id)).select('_id').lean()
  if (!enquiry) return sendError(res, 'Enquiry not found.', 404)
  const offers = await EnquiryOffer.find({ enquiry_id: enquiry._id }).populate('seller_company_id', 'name city state').sort({ created_at: -1 }).lean()
  return ok(res, { offers: offers.map(offerResponse) }, 'Offers retrieved.')
}

async function respondToOffer(req, res) {
  const action = String(req.body.action || '').toLowerCase()
  if (!['accept', 'reject'].includes(action)) return sendError(res, 'action must be accept or reject.', 400)
  const enquiry = await Enquiry.findOne(buyerEnquiryQuery(req, req.params.id)).lean()
  if (!enquiry) return sendError(res, 'Enquiry not found.', 404)
  if (enquiry.status === 'Cancelled') return sendError(res, 'Cancelled enquiries cannot accept offers.', 409)

  const status = action === 'accept' ? 'Accepted' : 'Rejected'
  let offer
  try {
    offer = await EnquiryOffer.findOneAndUpdate(
      { _id: req.params.offerId, enquiry_id: enquiry._id, buyer_company_id: req.user.company_id, buyer_user_id: req.user._id, status: 'Pending' },
      { status, responded_at: new Date() },
      { new: true }
    ).populate('seller_company_id', 'name city state').lean()
  } catch (error) {
    if (error?.code === 11000) return sendError(res, 'Another offer has already been accepted for this enquiry.', 409)
    throw error
  }
  if (!offer) return sendError(res, 'Pending offer not found.', 404)

  if (status === 'Accepted') {
    await Promise.all([
      EnquiryOffer.updateMany({ enquiry_id: enquiry._id, _id: { $ne: offer._id }, status: 'Pending' }, { status: 'Withdrawn', responded_at: new Date() }),
      Enquiry.updateOne({ _id: enquiry._id }, { status: 'Confirmed', offered_price: offer.unit_price, distributor_reply: offer.notes || '' }),
    ])
  }
  await Notification.create({
    company_id: offer.seller_company_id._id || offer.seller_company_id,
    user_id: offer.seller_user_id,
    type: 'offer_response', title: `Offer ${status.toLowerCase()}`,
    message: `${req.company.name} ${status.toLowerCase()} your offer for ${enquiry.enq_code}.`, reference_id: enquiry._id,
  })
  // Push notification to seller about offer response
  notifySeller(offer.seller_user_id, {
    title: `Offer ${status}!`,
    body: `${req.company.name} ${status.toLowerCase()} your offer for ${enquiry.enq_code}.`,
    type: 'offer_response',
    referenceId: enquiry._id,
  })
  return ok(res, offerResponse(offer), `Offer ${status.toLowerCase()}.`)
}

async function sellerListOffers(req, res) {
  const enquiry = await Enquiry.findOne({ _id: req.params.id, seller_company_id: req.user.company_id, company_id: req.user.company_id }).lean()
  if (!enquiry) return sendError(res, 'Seller enquiry not found.', 404)
  const offers = await EnquiryOffer.find({ enquiry_id: enquiry._id, seller_company_id: req.user.company_id }).populate('seller_company_id', 'name city state').sort({ created_at: -1 }).lean()
  return ok(res, { offers: offers.map(offerResponse) }, 'Offers retrieved.')
}

async function sellerCreateOffer(req, res) {
  const enquiry = await Enquiry.findOne({ _id: req.params.id, seller_company_id: req.user.company_id, company_id: req.user.company_id }).lean()
  if (!enquiry || !enquiry.buyer_company_id || !enquiry.buyer_user_id) return sendError(res, 'Retailer marketplace enquiry not found.', 404)
  if (['Cancelled', 'Confirmed'].includes(enquiry.status)) return sendError(res, 'This enquiry is no longer open for offers.', 409)

  // A FREE-TEXT enquiry carries no product_id, so there is no catalogue row to
  // read the GST rate from — the seller supplies it (or it defaults to 0). When
  // a product IS attached, keep the original lookup + ownership check.
  const product = enquiry.product_id
    ? await Product.findOne({ _id: enquiry.product_id, company_id: req.user.company_id }).select('gst_percent').lean()
    : null
  if (enquiry.product_id && !product) return sendError(res, 'Product not found for this seller.', 404)
  const unitPrice = nonNegative(req.body.unit_price, 'unit_price')
  if (unitPrice <= 0) return sendError(res, 'unit_price must be greater than zero.', 400)
  const transport = nonNegative(req.body.transport_charge, 'transport_charge')
  const packing = nonNegative(req.body.packing_charge, 'packing_charge')
  const other = nonNegative(req.body.other_charge, 'other_charge')
  const gstPercent = req.body.gst_percent === undefined ? nonNegative(product?.gst_percent, 'gst_percent') : nonNegative(req.body.gst_percent, 'gst_percent')
  if (gstPercent > 100) return sendError(res, 'gst_percent must not exceed 100.', 400)
  const amount = money(enquiry.qty * unitPrice)
  const gstAmount = money(amount * gstPercent / 100)
  const total = money(amount + gstAmount + transport + packing + other)

  await EnquiryOffer.updateMany({ enquiry_id: enquiry._id, seller_company_id: req.user.company_id, status: 'Pending' }, { status: 'Withdrawn' })
  const offer = await EnquiryOffer.create({
    enquiry_id: enquiry._id, buyer_company_id: enquiry.buyer_company_id, buyer_user_id: enquiry.buyer_user_id,
    seller_company_id: req.user.company_id, seller_user_id: req.user._id, product_id: enquiry.product_id || null,
    qty: enquiry.qty, unit: enquiry.unit, unit_price: unitPrice, gst_percent: gstPercent,
    amount, gst_amount: gstAmount, transport_charge: transport, packing_charge: packing,
    other_charge: other, total_amount: total,
    available_quantity: (req.body.available_quantity !== undefined && req.body.available_quantity !== '' && !isNaN(parseFloat(req.body.available_quantity))) ? parseFloat(req.body.available_quantity) : null,
    delivery_timeline: String(req.body.delivery_timeline || '').trim().slice(0, 100),
    notes: String(req.body.notes || '').trim().slice(0, 2000),
  })
  await Enquiry.updateOne({ _id: enquiry._id }, { status: 'Replied', offered_price: unitPrice, distributor_reply: offer.notes || '' })
  await Notification.create({
    company_id: enquiry.buyer_company_id, user_id: enquiry.buyer_user_id,
    type: 'enquiry_offer', title: `New offer for ${enquiry.enq_code}`,
    message: `${req.company.name} offered ₹${unitPrice} per ${enquiry.unit}.`, reference_id: enquiry._id,
  })
  // Push notification to retailer
  notifyRetailer(enquiry.buyer_user_id, {
    title: `New offer for ${enquiry.enq_code}`,
    body: `${req.company.name} offered ₹${unitPrice} per ${enquiry.unit}.`,
    type: 'enquiry_offer',
    referenceId: enquiry._id,
  })
  const populated = await EnquiryOffer.findById(offer._id).populate('seller_company_id', 'name city state').lean()
  return ok(res, offerResponse(populated), 'Offer sent.', 201)
}

async function sellerListMessages(req, res) {
  const enquiry = await Enquiry.findOne({ _id: req.params.id, seller_company_id: req.user.company_id, company_id: req.user.company_id }).lean()
  if (!enquiry) return sendError(res, 'Seller enquiry not found.', 404)
  const messages = await EnquiryMessage.find({ enquiry_id: enquiry._id }).populate('sender_user_id', 'name role').sort({ created_at: 1 }).lean()
  // Mirror the buyer-side shape so a single renderer can render bubbles for
  // either side without per-call branching on which field is present.
  return ok(res, { messages: messages.map(item => ({
    id: item._id, message: item.message, sender_side: item.sender_side,
    seller_company_id: item.seller_company_id,
    sender: item.sender_user_id ? { id: item.sender_user_id._id, name: item.sender_user_id.name } : null,
    client_message_id: item.client_message_id || '', created_at: item.created_at,
  })) }, 'Messages retrieved.')
}

async function sellerCreateMessage(req, res) {
  const message = String(req.body.message || '').trim()
  const clientMessageId = String(req.body.client_message_id || '').trim()
  if (!message || message.length > 2000) return sendError(res, 'message is required and must not exceed 2000 characters.', 400)
  const enquiry = await Enquiry.findOne({ _id: req.params.id, seller_company_id: req.user.company_id, company_id: req.user.company_id }).lean()
  if (!enquiry || !enquiry.buyer_user_id) return sendError(res, 'Retailer marketplace enquiry not found.', 404)
  if (enquiry.status === 'Cancelled') return sendError(res, 'Messages cannot be sent on a cancelled enquiry.', 409)

  if (clientMessageId) {
    const existing = await EnquiryMessage.findOne({ sender_user_id: req.user._id, client_message_id: clientMessageId }).lean()
    if (existing) return ok(res, existing, 'Message already received.')
  }
  const created = await EnquiryMessage.create({
    enquiry_id: enquiry._id, buyer_company_id: enquiry.buyer_company_id, buyer_user_id: enquiry.buyer_user_id,
    seller_company_id: enquiry.seller_company_id, sender_user_id: req.user._id, sender_side: 'seller',
    message, client_message_id: clientMessageId,
  })
  await Notification.create({
    company_id: enquiry.buyer_company_id, user_id: enquiry.buyer_user_id,
    type: 'enquiry_message', title: `Message on ${enquiry.enq_code}`,
    message: `${req.company.name}: ${message.slice(0, 120)}`, reference_id: enquiry._id,
  })
  // Push notification to retailer
  notifyRetailer(enquiry.buyer_user_id, {
    title: `Message on ${enquiry.enq_code}`,
    body: `${req.company.name}: ${message.slice(0, 100)}`,
    type: 'enquiry_message',
    referenceId: enquiry._id,
  })
  return ok(res, created.toObject(), 'Message sent.', 201)
}

async function createOrder(req, res) {
  const offerId = req.body.offer_id
  if (!isObjectId(offerId)) return sendError(res, 'A valid accepted offer_id is required.', 400)
  const existing = await Order.findOne({ offer_id: offerId, ...buyerOrderQuery(req) }).populate('seller_company_id', 'name city state').populate('product_id', 'code name image_urls').lean()
  if (existing) return ok(res, orderResponse(existing), 'Order already exists for this offer.')

  const offer = await EnquiryOffer.findOne({ _id: offerId, buyer_company_id: req.user.company_id, buyer_user_id: req.user._id, status: 'Accepted' }).lean()
  if (!offer) return sendError(res, 'Accepted offer not found.', 404)
  const enquiry = await Enquiry.findOne({ _id: offer.enquiry_id, ...buyerEnquiryQuery(req) }).lean()
  if (!enquiry) return sendError(res, 'Enquiry not found.', 404)
  const product = await Product.findOne({ _id: offer.product_id, company_id: offer.seller_company_id }).select('code name').lean()
  if (!product) return sendError(res, 'Product is no longer available from this seller.', 409)

  let deliveryAddress = String(req.body.delivery_address || '').trim()
  if (req.body.address_id) {
    const address = (req.company.addresses || []).find(item => item._id?.toString() === String(req.body.address_id))
    if (!address) return sendError(res, 'Address not found.', 404)
    deliveryAddress = [address.address, address.city, address.state, address.pin_code].filter(Boolean).join(', ')
  }
  if (!deliveryAddress) {
    const defaultAddress = (req.company.addresses || []).find(item => item.is_default) || req.company.addresses?.[0]
    deliveryAddress = defaultAddress
      ? [defaultAddress.address, defaultAddress.city, defaultAddress.state, defaultAddress.pin_code].filter(Boolean).join(', ')
      : [req.company.address, req.company.city, req.company.state, req.company.pin_code].filter(Boolean).join(', ')
  }
  if (!deliveryAddress) return sendError(res, 'A delivery address is required.', 400)

  const amount = money(offer.qty * offer.unit_price)
  const gstAmount = money(amount * offer.gst_percent / 100)
  const totalAmount = money(amount + gstAmount + offer.transport_charge + offer.packing_charge + offer.other_charge)
  const orderCode = `ORD-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}-${crypto.randomInt(100, 999)}`

  let order
  try {
    order = await Order.create({
      order_code: orderCode, company_id: offer.seller_company_id,
      buyer_company_id: req.user.company_id, buyer_user_id: req.user._id,
      seller_company_id: offer.seller_company_id, offer_id: offer._id,
      enquiry_id: enquiry._id, enquiry_code: enquiry.enq_code,
      customer_name: req.company.name, customer_mobile: req.user.mobile || req.company.mobile || '',
      customer_email: req.user.email || req.company.email || '', delivery_address,
      location: req.company.city || '', product_id: product._id, product_code: product.code,
      product_name: product.name, unit: offer.unit, qty: offer.qty, rate: offer.unit_price,
      amount, gst_percent: offer.gst_percent, gst_amount: gstAmount, total_amount: totalAmount,
      transport_cost: offer.transport_charge, packing_cost: offer.packing_charge, other_cost: offer.other_charge,
      notes: String(req.body.notes || '').trim().slice(0, 2000), created_by: req.user._id,
      created_by_name: req.user.name || '', status: 'New', order_date: new Date(),
      status_history: [{ status: 'New', updated_by: req.user._id, updated_by_name: req.user.name || '', updated_by_role: 'Retailer', remarks: 'Order created from accepted offer', timestamp: new Date() }],
    })
  } catch (error) {
    if (error?.code === 11000) {
      const duplicate = await Order.findOne({ offer_id: offerId }).populate('seller_company_id', 'name city state').populate('product_id', 'code name image_urls').lean()
      if (duplicate && duplicate.buyer_user_id?.toString() === req.user._id.toString()) return ok(res, orderResponse(duplicate), 'Order already exists for this offer.')
    }
    throw error
  }
  await Promise.all([
    Enquiry.updateOne({ _id: enquiry._id }, { order_id: order._id, status: 'Confirmed' }),
    Notification.create({ company_id: req.user.company_id, user_id: req.user._id, type: 'order_created', title: `Order ${orderCode} created`, message: `Your order total is ₹${totalAmount}.`, reference_id: order._id }),
    Notification.create({ company_id: offer.seller_company_id, user_id: offer.seller_user_id, type: 'retailer_order', title: `New retailer order ${orderCode}`, message: `${req.company.name} placed an order from ${enquiry.enq_code}.`, reference_id: order._id }),
  ])
  // NOTE: Seller's stock is no longer deducted at retailer order creation (booking).
  // Per workflow: seller must "Accept" the order first → then Available → Reserved.
  // When seller accepts via admin → orderController.updateOrderStatus handles reserve.
  // const deducted = await deductStockForOrder(order, req.user._id)
  // if (deducted) await Order.updateOne({ _id: order._id }, { stock_deducted: true })

  // Push notification to seller about new order
  notifySeller(offer.seller_user_id, {
    title: `New Order ${orderCode}`,
    body: `${req.company.name} placed an order worth ₹${totalAmount}.`,
    type: 'retailer_order',
    referenceId: order._id,
  })
  const populated = await Order.findById(order._id).populate('seller_company_id', 'name city state').populate('product_id', 'code name image_urls').lean()
  return ok(res, orderResponse(populated), 'Order created.', 201)
}

async function listOrders(req, res) {
  const { page, limit, skip } = parsePagination(req.query)
  const query = buyerOrderQuery(req)
  if (req.query.status && req.query.status !== 'All') {
    const group = STATUS_GROUPS[String(req.query.status)]
    query.status = group ? { $in: group } : String(req.query.status)
  }
  if (req.query.search) {
    const regex = new RegExp(escapeRegex(req.query.search), 'i')
    query.$or = [{ order_code: regex }, { product_name: regex }, { enquiry_code: regex }]
  }
  const [total, orders] = await Promise.all([
    Order.countDocuments(query),
    Order.find(query).select('-purchase_rate -purchase_cost -warehouse_status').populate('seller_company_id', 'name city state').populate('product_id', 'code name image_urls').sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
  ])
  return ok(res, { orders: orders.map(orderResponse) }, 'Orders retrieved.', 200, paginate(total, page, limit))
}

async function getOrder(req, res) {
  if (!isObjectId(req.params.id)) return sendError(res, 'Order not found.', 404)
  const order = await Order.findOne(buyerOrderQuery(req, req.params.id)).select('-purchase_rate -purchase_cost -warehouse_status').populate('seller_company_id', 'name city state').populate('buyer_company_id', 'name mobile email city state').populate('product_id', 'code name image_urls').lean()
  if (!order) return sendError(res, 'Order not found.', 404)
  return ok(res, orderResponse(order), 'Order retrieved.')
}

async function cancelOrder(req, res) {
  // Orders can only be cancelled before packing starts.
  // Legacy statuses included for backward-compat with existing DB records.
  const cancellable = ['New', 'Accepted', 'Packing',
    'Pending Approval', 'Approved']
  const history = {
    status: 'Cancelled', updated_by: req.user._id, updated_by_name: req.user.name || '',
    updated_by_role: 'Retailer', remarks: String(req.body.reason || 'Cancelled by retailer').slice(0, 500), timestamp: new Date(),
  }
  const order = await Order.findOneAndUpdate(
    { ...buyerOrderQuery(req, req.params.id), status: { $in: cancellable } },
    { status: 'Cancelled', $push: { status_history: history } },
    { new: true }
  ).select('-purchase_rate -purchase_cost -warehouse_status').populate('seller_company_id', 'name city state').populate('product_id', 'code name image_urls').lean()
  if (!order) return sendError(res, 'Order cannot be cancelled at its current stage.', 409)

  // Return the booked quantity to the seller's inventory.
  if (order.stock_deducted) {
    const restoreOrder = {
      ...order,
      product_id: order.product_id?._id || order.product_id,
    }
    // Stock lives in the SELLER's bucket — pass it explicitly, because an
    // unscoped inventory lookup would be ambiguous across companies.
    const restored = await restoreStockForOrder(
      restoreOrder,
      req.user._id,
      order.seller_company_id?._id || order.seller_company_id || order.company_id
    )
    if (restored) await Order.updateOne({ _id: order._id }, { stock_deducted: false })
  } else {
    // New reserve-bucket path: stock reserved when seller Accepted the order.
    const sellerCompanyId = order.seller_company_id?._id || order.seller_company_id
    const productId = order.product_id?._id || order.product_id
    const released = await releaseReserveForOrder({
      companyId:   sellerCompanyId,
      productId:   productId,
      warehouseId: order.warehouse_id || null,
      qty:         order.qty,
      orderId:     order._id,
      orderCode:   order.order_code,
      userId:      req.user._id,
    })
    if (!released.ok) console.warn('[retailer cancelOrder] release reserve failed:', released.error)
  }

  await Notification.create({
    company_id: order.seller_company_id._id || order.seller_company_id,
    type: 'order_cancelled', title: `Order ${order.order_code} cancelled`,
    message: `${req.company.name} cancelled this order.`, reference_id: order._id,
  })
  // Push notification to seller about order cancellation
  notifySeller(order.seller_user_id || null, {
    title: `Order ${order.order_code} Cancelled`,
    body: `${req.company.name} cancelled this order.`,
    type: 'order_cancelled',
    referenceId: order._id,
  })
  return ok(res, orderResponse(order), 'Order cancelled.')
}

async function tracking(req, res) {
  const order = await Order.findOne(buyerOrderQuery(req, req.params.id)).select('order_code status status_history seller_company_id qty dispatched_qty unit').lean()
  if (!order) return sendError(res, 'Order not found.', 404)

  // All dispatches for this order (supports partial packing → multiple shipments).
  const allDispatches = await Dispatch.find({ order_id: order._id, company_id: order.seller_company_id })
    .select('dispatch_code invoice_number qty unit vehicle_number transport_name driver_name driver_mobile lr_number dispatch_date expected_delivery_days expected_delivery delivered_date status created_at updated_at')
    .sort({ created_at: 1 }).lean()

  const shapeDispatch = d => ({
    id: d._id, dispatch_code: d.dispatch_code || '', invoice_number: d.invoice_number || '',
    qty: d.qty || 0, unit: d.unit || order.unit || '',
    vehicle_number: d.vehicle_number || '', transport_name: d.transport_name || '',
    driver_name: d.driver_name || '', driver_phone: d.driver_mobile || '',
    lr_number: d.lr_number || '', dispatch_date: d.dispatch_date,
    expected_delivery_days: d.expected_delivery_days, expected_delivery: d.expected_delivery,
    delivered_date: d.delivered_date, status: d.status, updated_at: d.updated_at,
  })

  // Keep `dispatch` (latest) for backward compatibility; add `dispatches` list.
  const latest = allDispatches.length ? allDispatches[allDispatches.length - 1] : null

  return ok(res, {
    order_id: order._id,
    order_code: order.order_code,
    status: ANDROID_STATUS[order.status] || 'Packing',
    internal_status: order.status,
    ordered_qty: order.qty || 0,
    dispatched_qty: order.dispatched_qty || 0,
    remaining_qty: Math.max(0, (order.qty || 0) - (order.dispatched_qty || 0)),
    unit: order.unit || '',
    history: (order.status_history || []).map(item => ({ status: ANDROID_STATUS[item.status] || 'Packing', internal_status: item.status, remarks: item.remarks || '', timestamp: item.timestamp })),
    dispatch: latest ? shapeDispatch(latest) : null,
    dispatches: allDispatches.map(shapeDispatch),
    capabilities: { live_gps_tracking: false },
  }, 'Tracking retrieved.')
}

// All dispatches for one of the buyer's orders (supports partial packing —
// an order may have several dispatches, one per packed batch).
async function listOrderDispatches(req, res) {
  const order = await Order.findOne(buyerOrderQuery(req, req.params.id)).select('_id order_code seller_company_id qty dispatched_qty unit').lean()
  if (!order) return sendError(res, 'Order not found.', 404)
  const dispatches = await Dispatch.find({ order_id: order._id, company_id: order.seller_company_id })
    .select('dispatch_code invoice_number qty unit vehicle_number transport_name driver_name driver_mobile lr_number dispatch_date expected_delivery_days expected_delivery delivered_date status created_at')
    .sort({ created_at: 1 }).lean()
  return ok(res, {
    order_id: order._id,
    order_code: order.order_code,
    ordered_qty: order.qty,
    dispatched_qty: order.dispatched_qty || 0,
    remaining_qty: Math.max(0, (order.qty || 0) - (order.dispatched_qty || 0)),
    unit: order.unit || '',
    dispatches: dispatches.map(d => ({
      id: d._id, dispatch_code: d.dispatch_code || '', invoice_number: d.invoice_number || '',
      qty: d.qty || 0, unit: d.unit || order.unit || '',
      vehicle_number: d.vehicle_number || '', transport_name: d.transport_name || '',
      driver_name: d.driver_name || '', driver_mobile: d.driver_mobile || '',
      lr_number: d.lr_number || '', dispatch_date: d.dispatch_date,
      expected_delivery_days: d.expected_delivery_days, expected_delivery: d.expected_delivery,
      delivered_date: d.delivered_date, status: d.status, created_at: d.created_at,
    })),
  }, 'Dispatches retrieved.')
}

// All invoices for one of the buyer's orders (one per packed batch).
async function listOrderInvoices(req, res) {
  const order = await Order.findOne(buyerOrderQuery(req, req.params.id)).select('_id order_code seller_company_id').lean()
  if (!order) return sendError(res, 'Order not found.', 404)
  const invoices = await Invoice.find({ order_id: order._id, company_id: order.seller_company_id })
    .select('invoice_no invoice_date items subtotal gst_amount grand_total paid_amount balance_due payment_status status created_at')
    .sort({ created_at: 1 }).lean()
  return ok(res, {
    order_id: order._id,
    order_code: order.order_code,
    invoices: invoices.map(inv => ({
      id: inv._id,
      invoice_no: inv.invoice_no || '', invoice_number: inv.invoice_no || '',
      invoice_date: inv.invoice_date,
      qty: (inv.items || []).reduce((s, it) => s + (Number(it.qty) || 0), 0),
      subtotal: inv.subtotal || 0, gst_amount: inv.gst_amount || 0,
      grand_total: inv.grand_total || 0, total_amount: inv.grand_total || 0,
      paid_amount: inv.paid_amount || 0, balance_due: inv.balance_due || 0,
      payment_status: inv.payment_status || 'Unpaid', status: inv.status || '',
      created_at: inv.created_at,
    })),
  }, 'Invoices retrieved.')
}

// Shape a full Invoice doc for the retailer app.
function retailerInvoiceResponse(inv, order) {
  const item = (inv.items || [])[0] || {}
  const qty = (inv.items || []).reduce((s, it) => s + (Number(it.qty) || 0), 0)
  return {
    id: inv._id,
    invoice_number: inv.invoice_no || '',
    invoice_no: inv.invoice_no || '',
    invoice_date: inv.invoice_date,
    order_id: order?._id || inv.order_id || null,
    order_code: order?.order_code || inv.order_no || '',
    // The retailer's end-customer this supply is for.
    customer: {
      name: inv.customer_name || order?.customer_name || '',
      mobile: inv.customer_phone || order?.customer_mobile || '',
      email: inv.customer_email || order?.customer_email || '',
      address: inv.shipping_address || inv.billing_address || order?.delivery_address || '',
    },
    // Who generated the invoice (the Admin/seller).
    created_by: {
      name: inv.created_by_person || inv.created_by_name || '',
      company: inv.created_by_company || '',
      mobile: inv.created_by_mobile || '',
      email: inv.created_by_email || '',
      type: inv.created_by_type || 'Admin',
    },
    // The retailer this supply was routed through (shown after Customer).
    retailer: {
      name: inv.retailer_name || order?.created_by_person || order?.created_by_name || '',
      company: inv.retailer_company || order?.created_by_company || '',
      mobile: inv.retailer_mobile || order?.created_by_mobile || '',
      email: inv.retailer_email || order?.created_by_email || '',
    },
    product_name: item.product_name || order?.product_name || '',
    product: { name: item.product_name || order?.product_name || '', code: item.product_code || order?.product_code || '' },
    qty,
    unit: item.unit || order?.unit || '',
    unit_price: item.rate || 0,
    amount: inv.subtotal || 0,
    gst_percent: item.gst_percent || 0,
    gst_amount: inv.gst_amount || 0,
    charges: { transport: 0, packing: 0, other: inv.other_charges || 0 },
    total_amount: inv.grand_total || 0,
    grand_total: inv.grand_total || 0,
    paid_amount: inv.paid_amount || 0,
    balance_due: inv.balance_due || 0,
    payment_status: inv.payment_status || 'Unpaid',
    status: inv.status || '',
    created_at: inv.created_at,
  }
}

// ── Delivery OTP ─────────────────────────────────────────────────────────────
// POST /retailer/orders/:id/delivery-otp
// Retailer requests a delivery OTP to be sent to their registered mobile.
async function requestDeliveryOtp(req, res) {
  if (!isObjectId(req.params.id)) return sendError(res, 'Order not found.', 404)
  const order = await Order.findOne(buyerOrderQuery(req, req.params.id))
    .select('_id order_code status').lean()
  if (!order) return sendError(res, 'Order not found.', 404)
  if (!['Dispatched', 'Out for Delivery'].includes(ANDROID_STATUS[order.status] || order.status)) {
    return sendError(res, 'Delivery OTP is only available for dispatched orders.', 409)
  }
  // Generate a 6-digit OTP and store on the order.
  const otp = String(Math.floor(100000 + Math.random() * 900000))
  const expiry = new Date(Date.now() + 15 * 60 * 1000) // 15 min
  await Order.updateOne({ _id: order._id }, { delivery_otp: otp, delivery_otp_expires_at: expiry })
  // In dev mode, return the OTP in the response for testing.
  const devPayload = process.env.NODE_ENV !== 'production' ? { otp } : {}
  return ok(res, { message: 'OTP sent to your registered mobile.', ...devPayload }, 'OTP sent.')
}

// POST /retailer/orders/:id/delivery-otp/verify
// Retailer confirms delivery by entering the OTP.
async function confirmDeliveryOtp(req, res) {
  if (!isObjectId(req.params.id)) return sendError(res, 'Order not found.', 404)
  const { otp } = req.body || {}
  if (!otp) return sendError(res, 'OTP is required.', 400)
  const order = await Order.findOne(buyerOrderQuery(req, req.params.id))
    .select('_id order_code status delivery_otp delivery_otp_expires_at').lean()
  if (!order) return sendError(res, 'Order not found.', 404)
  if (!order.delivery_otp) return sendError(res, 'No OTP was requested for this order.', 409)
  if (new Date() > new Date(order.delivery_otp_expires_at)) return sendError(res, 'OTP has expired. Please request a new one.', 410)
  if (String(order.delivery_otp) !== String(otp)) return sendError(res, 'Invalid OTP.', 400)
  await Order.updateOne({ _id: order._id }, {
    status: 'Delivered',
    delivery_otp: null,
    delivery_otp_expires_at: null,
    $push: { status_history: { status: 'Delivered', updated_by: req.user._id, updated_by_name: req.user.name || '', updated_by_role: 'Retailer', remarks: 'Delivery confirmed by retailer OTP', timestamp: new Date() } },
  })
  const updated = await Order.findById(order._id)
    .select('-purchase_rate -purchase_cost -warehouse_status')
    .populate('seller_company_id', 'name city state')
    .populate('product_id', 'code name image_urls').lean()
  return ok(res, orderResponse(updated), 'Delivery confirmed.')
}

// ── Payment ───────────────────────────────────────────────────────────────────
// POST /retailer/invoices/:id/pay
// Initiate a payment against an invoice (currently records as manual/cash payment).
async function initiatePayment(req, res) {
  if (!isObjectId(req.params.id)) return sendError(res, 'Invoice not found.', 404)
  const invoice = await Invoice.findById(req.params.id).lean()
  if (!invoice) return sendError(res, 'Invoice not found.', 404)
  // Verify this invoice belongs to one of the retailer's orders.
  const order = await Order.findOne({ _id: invoice.order_id, buyer_company_id: req.user.company_id, buyer_user_id: req.user._id }).lean()
  if (!order) return sendError(res, 'Invoice not found.', 404)
  if ((invoice.balance_due || 0) <= 0) return sendError(res, 'This invoice is already fully paid.', 409)
  const method = String(req.body?.method || 'Online')
  // Return a gateway placeholder. Actual payment gateway integration should
  // replace this with a real gateway SDK call (Razorpay, PayU, etc.).
  return ok(res, {
    invoice_id: invoice._id,
    invoice_number: invoice.invoice_no || '',
    amount: invoice.balance_due || 0,
    currency: 'INR',
    method,
    // Gateway order ID placeholder — replace with real gateway response.
    gateway_order_id: `PAY-${Date.now()}-${crypto.randomInt(1000, 9999)}`,
    status: 'created',
  }, 'Payment initiated.')
}

// POST /retailer/invoices/:id/pay/confirm
// Confirm the gateway result and record the payment against the invoice.
async function confirmPayment(req, res) {
  if (!isObjectId(req.params.id)) return sendError(res, 'Invoice not found.', 404)
  const invoice = await Invoice.findById(req.params.id).lean()
  if (!invoice) return sendError(res, 'Invoice not found.', 404)
  const order = await Order.findOne({ _id: invoice.order_id, buyer_company_id: req.user.company_id, buyer_user_id: req.user._id }).lean()
  if (!order) return sendError(res, 'Invoice not found.', 404)
  const amount = Number(req.body?.amount || invoice.balance_due || 0)
  if (amount <= 0) return sendError(res, 'Payment amount must be greater than zero.', 400)
  const newPaid = money((invoice.paid_amount || 0) + amount)
  const newBalance = money(Math.max(0, (invoice.grand_total || 0) - newPaid))
  const paymentStatus = newBalance <= 0 ? 'Paid' : 'Partially Paid'
  await Invoice.updateOne({ _id: invoice._id }, {
    paid_amount: newPaid,
    balance_due: newBalance,
    payment_status: paymentStatus,
  })
  const updated = await Invoice.findById(invoice._id).lean()
  return ok(res, retailerInvoiceResponse(updated, order), 'Payment recorded.')
}

// GET /retailer/invoices — all invoices belonging to this buyer's orders.
async function listInvoices(req, res) {
  const { page, limit, skip } = parsePagination(req.query)
  const orderFilter = { buyer_company_id: req.user.company_id, buyer_user_id: req.user._id }
  if (req.query.order_id && isObjectId(req.query.order_id)) orderFilter._id = req.query.order_id
  const orders = await Order.find(orderFilter).select('_id order_code product_name product_code unit seller_company_id customer_name customer_mobile customer_email delivery_address created_by_name created_by_company created_by_person created_by_mobile created_by_email').lean()
  const orderMap = new Map(orders.map(o => [String(o._id), o]))
  const orderIds = orders.map(o => o._id)
  if (!orderIds.length) return ok(res, { invoices: [] }, 'Invoices retrieved.', 200, paginate(0, page, limit))

  const query = { order_id: { $in: orderIds } }
  const [total, invoices] = await Promise.all([
    Invoice.countDocuments(query),
    Invoice.find(query).sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
  ])
  return ok(res, {
    invoices: invoices.map(inv => retailerInvoiceResponse(inv, orderMap.get(String(inv.order_id)))),
  }, 'Invoices retrieved.', 200, paginate(total, page, limit))
}

// GET /retailer/invoices/:id — a single invoice (must belong to buyer's order).
async function getInvoice(req, res) {
  if (!isObjectId(req.params.id)) return sendError(res, 'Invoice not found.', 404)
  const invoice = await Invoice.findById(req.params.id).lean()
  if (!invoice || !invoice.order_id) return sendError(res, 'Invoice not found.', 404)
  const order = await Order.findOne({ _id: invoice.order_id, buyer_company_id: req.user.company_id, buyer_user_id: req.user._id })
    .select('_id order_code product_name product_code unit customer_name customer_mobile customer_email delivery_address created_by_name created_by_company created_by_person created_by_mobile created_by_email').lean()
  if (!order) return sendError(res, 'Invoice not found.', 404)
  return ok(res, retailerInvoiceResponse(invoice, order), 'Invoice retrieved.')
}

async function listNotifications(req, res) {
  const { page, limit, skip } = parsePagination(req.query)
  const query = { company_id: req.user.company_id, user_id: req.user._id }
  if (req.query.unread === 'true') query.is_read = false
  const [total, notifications, unread] = await Promise.all([
    Notification.countDocuments(query),
    Notification.find(query).sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments({ company_id: req.user.company_id, user_id: req.user._id, is_read: false }),
  ])
  return ok(res, { notifications, unread_count: unread }, 'Notifications retrieved.', 200, paginate(total, page, limit))
}

async function readNotification(req, res) {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id, user_id: req.user._id },
    { is_read: true }, { new: true }
  ).lean()
  if (!notification) return sendError(res, 'Notification not found.', 404)
  return ok(res, notification, 'Notification marked read.')
}

async function readAllNotifications(req, res) {
  const result = await Notification.updateMany(
    { company_id: req.user.company_id, user_id: req.user._id, is_read: false },
    { is_read: true }
  )
  return ok(res, { updated: result.modifiedCount }, 'Notifications marked read.')
}

// Delete a single notification belonging to this retailer.
async function deleteNotification(req, res) {
  if (!isObjectId(req.params.id)) return sendError(res, 'Notification not found.', 404)
  const deleted = await Notification.findOneAndDelete({
    _id: req.params.id, company_id: req.user.company_id, user_id: req.user._id,
  }).lean()
  if (!deleted) return sendError(res, 'Notification not found.', 404)
  return ok(res, { id: deleted._id }, 'Notification deleted.')
}

// ── POST /retailer/enquiries/:id/reply-history ───────────────────────────────
async function createReplyHistory(req, res) {
  const { offered_price, available_quantity, delivery_timeline, remarks, unit } = req.body
  if (offered_price == null) return sendError(res, 'offered_price is required.', 400)

  const enquiry = await Enquiry.findOne({
    _id: req.params.id,
    $or: [
      { company_id: req.user.company_id },
      { buyer_company_id: req.user.company_id },
      { broadcast_owner_company_id: req.user.company_id },
    ],
  }).lean()
  if (!enquiry) return sendError(res, 'Enquiry not found.', 404)

  const me = String(req.user.company_id)
  let senderSide = 'seller'
  if (String(enquiry.broadcast_owner_company_id) === me || String(enquiry.buyer_company_id) === me) {
    senderSide = 'buyer'
  } else if (String(enquiry.company_id) === me) {
    senderSide = 'seller'
  }

  const history = await EnquiryReplyHistory.create({
    enquiry_id:         enquiry._id,
    enq_code:           enquiry.enq_code || '',
    sender_company_id:  req.user.company_id,
    sender_user_id:     req.user._id,
    sender_name:        req.user.name || req.company?.name || '',
    sender_side:        senderSide,
    offered_price:      Number(offered_price),
    available_quantity: available_quantity != null ? Number(available_quantity) : null,
    unit:               unit || enquiry.unit || '',
    delivery_timeline:  String(delivery_timeline || '').trim(),
    remarks:            String(remarks || '').trim(),
  })

  // Update the enquiry row with latest values
  await Enquiry.findByIdAndUpdate(enquiry._id, {
    offered_price:      Number(offered_price),
    available_quantity: available_quantity != null ? Number(available_quantity) : undefined,
    delivery_timeline:  String(delivery_timeline || '').trim(),
    distributor_reply:  String(remarks || '').trim(),
    status:             'Replied',
  })

  return ok(res, {
    id:                 history._id,
    offered_price:      history.offered_price,
    available_quantity: history.available_quantity,
    unit:               history.unit,
    delivery_timeline:  history.delivery_timeline,
    remarks:            history.remarks,
    sender_side:        history.sender_side,
    sender_name:        history.sender_name,
    created_at:         history.created_at,
  }, 'Reply saved.', 201)
}

// ── GET /retailer/enquiries/:id/reply-history ────────────────────────────────
async function listReplyHistory(req, res) {
  const enquiry = await Enquiry.findOne({
    _id: req.params.id,
    $or: [
      { company_id: req.user.company_id },
      { buyer_company_id: req.user.company_id },
      { broadcast_owner_company_id: req.user.company_id },
    ],
  }).select('_id enq_code broadcast_owner_company_id').lean()
  if (!enquiry) return sendError(res, 'Enquiry not found.', 404)

  // Conversation isolation for broadcasts:
  //   • The broadcast OWNER (sender) sees reply history across every recipient
  //     sibling.
  //   • A plain RECIPIENT sees ONLY their own row's history — NOT other
  //     recipients' replies. This is why a wholesaler's reply was showing up in
  //     the retailer's own reply form on an admin-created broadcast.
  const isBroadcastOwner = enquiry.broadcast_owner_company_id
    && String(enquiry.broadcast_owner_company_id) === String(req.user.company_id)
  const filter = (enquiry.enq_code && isBroadcastOwner)
    ? { enq_code: enquiry.enq_code }
    : { enquiry_id: enquiry._id }

  const history = await EnquiryReplyHistory.find(filter).sort({ created_at: 1 }).lean()

  return ok(res, {
    total: history.length,
    replies: history.map(h => ({
      id:                 h._id,
      offered_price:      h.offered_price,
      available_quantity: h.available_quantity,
      unit:               h.unit,
      delivery_timeline:  h.delivery_timeline,
      remarks:            h.remarks,
      sender_side:        h.sender_side,
      sender_name:        h.sender_name,
      created_at:         h.created_at,
    })),
  }, 'Reply history retrieved.')
}

module.exports = {
  ANDROID_STATUS,
  dashboard,
  listProducts,
  getProduct,
  getProductFilters,
  listRetailerCustomers,
  createRetailerCustomer,
  updateRetailerCustomer,
  deleteRetailerCustomer,
  createEnquiry,
  listEnquiries,
  getEnquiry,
  updateEnquiry,
  enquiryReplies,
  cancelEnquiry,
  listMessages,
  createBuyerMessage,
  listOffers,
  respondToOffer,
  sellerListOffers,
  createReplyHistory,
  listReplyHistory,
  sellerCreateOffer,
  sellerListMessages,
  sellerCreateMessage,
  createOrder,
  listOrders,
  getOrder,
  cancelOrder,
  tracking,
  listOrderDispatches,
  listOrderInvoices,
  listInvoices,
  getInvoice,
  requestDeliveryOtp,
  confirmDeliveryOtp,
  initiatePayment,
  confirmPayment,
  listNotifications,
  readNotification,
  readAllNotifications,
  deleteNotification,
}
