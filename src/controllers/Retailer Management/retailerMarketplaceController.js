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
const Order = require('../../models/Marketplace Management/Order')
const Dispatch = require('../../models/Marketplace Management/Dispatch')
const Notification = require('../../models/System Management/Notification')
const { sendError, paginate } = require('../../utils/helpers')
const { notifyRetailer, notifySeller } = require('../../utils/pushHelper')

const PRODUCT_SELECT = [
  'company_id', 'code', 'name', 'alias', 'brand_id', 'category_id', 'sub_category_id',
  'hsn_code', 'size', 'finish', 'material', 'color', 'surface', 'thickness', 'grade',
  'tile_type', 'application', 'anti_skid', 'origin', 'manufacturer', 'design', 'collection',
  'pcs_per_box', 'sqft_per_box', 'weight_per_box', 'unit', 'gst_percent', 'description',
  'selling_price', 'dealer_price', 'retail_price', 'mrp', 'new_arrival', 'featured', 'image_urls',
  'created_at', 'updated_at',
].join(' ')

const ANDROID_STATUS = {
  New: 'New',
  'Pending Approval': 'Accepted',
  Approved: 'Accepted',
  'Picking Started': 'Processing',
  'Picking Completed': 'Processing',
  'Sorting Started': 'Processing',
  'Sorting Completed': 'Processing',
  'Packing Started': 'Processing',
  'Packing Completed': 'Processing',
  'Invoice Generated': 'Processing',
  'Ready for Dispatch': 'ReadyForDispatch',
  Dispatched: 'Dispatched',
  'In Transit': 'InTransit',
  Delivered: 'Delivered',
  Cancelled: 'Cancelled',
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

function productResponse(product, stock = 0) {
  const seller = product.company_id || {}
  return {
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
      manufacturer: product.manufacturer || '', design: product.design || '', collection: product.collection || '',
    },
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
      mrp: product.mrp,
    },
    flags: { new_arrival: !!product.new_arrival, featured: !!product.featured },
    image_urls: product.image_urls || [],
    visible_stock: Math.max(Number(stock) || 0, 0),
    in_stock: Number(stock) > 0,
    seller: seller?._id ? {
      id: seller._id,
      company_code: seller.company_code || '',
      name: seller.name || '',
      city: seller.city || '',
      state: seller.state || '',
    } : null,
    created_at: product.created_at,
    updated_at: product.updated_at,
  }
}

function enquiryResponse(enquiry) {
  const seller = enquiry.seller_company_id || enquiry.company_id || {}
  const product = enquiry.product_id || {}
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
    product: product?._id ? {
      id: product._id,
      code: enquiry.product_code || product.code || '',
      name: enquiry.product_name || product.name || '',
      image_urls: product.image_urls || [],
    } : { id: null, code: enquiry.product_code || '', name: enquiry.product_name || '', image_urls: [] },
    seller: seller?._id ? { id: seller._id, name: seller.name || '', city: seller.city || '', state: seller.state || '' } : null,
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
    status: ANDROID_STATUS[order.status] || 'Processing',
    internal_status: order.status,
    product: {
      id: order.product_id?._id || order.product_id || null,
      code: order.product_code || order.product_id?.code || '',
      name: order.product_name || order.product_id?.name || '',
      image_urls: order.product_id?.image_urls || [],
    },
    seller: seller?._id ? { id: seller._id, name: seller.name || '', city: seller.city || '', state: seller.state || '' } : null,
    qty: order.qty,
    unit: order.unit,
    unit_price: order.rate,
    amount: order.amount,
    gst_percent: order.gst_percent,
    gst_amount: order.gst_amount,
    charges: { transport: order.transport_cost || 0, packing: order.packing_cost || 0, other: order.other_cost || 0 },
    total_amount: order.total_amount,
    delivery_address: order.delivery_address || '',
    invoice_number: order.invoice_number || '',
    invoice_date: order.invoice_date,
    status_history: (order.status_history || []).map(item => ({
      status: ANDROID_STATUS[item.status] || 'Processing',
      internal_status: item.status,
      remarks: item.remarks || '',
      timestamp: item.timestamp,
    })),
    created_at: order.created_at,
    updated_at: order.updated_at,
  }
}

function buyerEnquiryQuery(req, id = null) {
  const query = { buyer_company_id: req.user.company_id, buyer_user_id: req.user._id }
  if (id) query._id = id
  return query
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

async function getVisibleProduct(id) {
  if (!isObjectId(id)) return null
  const product = await Product.findOne({ _id: id, is_active: true, status: 'active', online_visible: true })
    .select(PRODUCT_SELECT)
    .populate({ path: 'company_id', match: { status: 'Approved', is_active: { $ne: false }, biz_type: { $ne: 'Retailer' } }, select: 'company_code name city state status is_active biz_type' })
    .populate('brand_id', 'name code')
    .populate('category_id', 'name code')
    .populate('sub_category_id', 'name code')
    .lean()
  return product?.company_id ? product : null
}

async function dashboard(req, res) {
  const [enquiries, orders, unread, recentOrders] = await Promise.all([
    Enquiry.countDocuments(buyerEnquiryQuery(req)),
    Order.countDocuments(buyerOrderQuery(req)),
    Notification.countDocuments({ company_id: req.user.company_id, user_id: req.user._id, is_read: false }),
    Order.find(buyerOrderQuery(req)).select('-purchase_rate -purchase_cost -warehouse_status').populate('seller_company_id', 'name city state').populate('product_id', 'code name image_urls').sort({ created_at: -1 }).limit(5).lean(),
  ])
  return ok(res, {
    counts: { enquiries, orders, unread_notifications: unread },
    recent_orders: recentOrders.map(orderResponse),
    company_status: req.company.status,
  })
}

async function listProducts(req, res) {
  const { page, limit, skip } = parsePagination(req.query)
  const companyQuery = { status: 'Approved', is_active: { $ne: false }, biz_type: { $ne: 'Retailer' } }
  if (req.query.location) {
    const location = new RegExp(escapeRegex(req.query.location), 'i')
    companyQuery.$or = [{ city: location }, { state: location }, { address: location }]
  }
  const sellerIds = await Company.find(companyQuery).distinct('_id')
  if (!sellerIds.length) return ok(res, { products: [] }, 'Products retrieved.', 200, paginate(0, page, limit))

  const query = { company_id: { $in: sellerIds }, is_active: true, status: 'active', online_visible: true }
  const search = String(req.query.search || '').trim()
  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i')
    query.$or = [{ code: regex }, { name: regex }, { alias: regex }, { design: regex }, { description: regex }]
  }
  for (const field of ['code', 'design', 'size', 'finish', 'color']) {
    if (req.query[field]) query[field] = new RegExp(escapeRegex(req.query[field]), 'i')
  }

  if (req.query.category) {
    const value = String(req.query.category)
    const categoryIds = isObjectId(value)
      ? [value]
      : await Category.find({ company_id: { $in: sellerIds }, $or: [{ name: new RegExp(escapeRegex(value), 'i') }, { code: new RegExp(escapeRegex(value), 'i') }] }).distinct('_id')
    query.category_id = { $in: categoryIds }
  }
  if (req.query.brand) {
    const value = String(req.query.brand)
    const brandIds = isObjectId(value)
      ? [value]
      : await Brand.find({ company_id: { $in: sellerIds }, $or: [{ name: new RegExp(escapeRegex(value), 'i') }, { code: new RegExp(escapeRegex(value), 'i') }] }).distinct('_id')
    query.brand_id = { $in: brandIds }
  }

  const [total, products] = await Promise.all([
    Product.countDocuments(query),
    Product.find(query).select(PRODUCT_SELECT)
      .populate('company_id', 'company_code name city state')
      .populate('brand_id', 'name code')
      .populate('category_id', 'name code')
      .populate('sub_category_id', 'name code')
      .sort({ featured: -1, new_arrival: -1, created_at: -1 })
      .skip(skip).limit(limit).lean(),
  ])
  const stocks = await stockMap(products.map(product => product._id))
  return ok(res, { products: products.map(product => productResponse(product, stocks.get(product._id.toString()))) }, 'Products retrieved.', 200, paginate(total, page, limit))
}

async function getProduct(req, res) {
  const product = await getVisibleProduct(req.params.id)
  if (!product) return sendError(res, 'Product not found or unavailable.', 404)
  const stocks = await stockMap([product._id])
  return ok(res, productResponse(product, stocks.get(product._id.toString())), 'Product retrieved.')
}

async function createEnquiry(req, res) {
  const product = await getVisibleProduct(req.body.product_id)
  if (!product) return sendError(res, 'Product not found or unavailable.', 404)
  const qty = Number(req.body.qty)
  if (!Number.isFinite(qty) || qty <= 0) return sendError(res, 'qty must be greater than zero.', 400)

  const company = req.company
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
  const query = buyerEnquiryQuery(req)
  if (req.query.status && req.query.status !== 'All') query.status = String(req.query.status)
  if (req.query.search) {
    const regex = new RegExp(escapeRegex(req.query.search), 'i')
    query.$or = [{ enq_code: regex }, { product_name: regex }]
  }
  const [total, enquiries] = await Promise.all([
    Enquiry.countDocuments(query),
    Enquiry.find(query).populate('seller_company_id', 'name city state').populate('product_id', 'code name image_urls').sort({ created_at: -1 }).skip(skip).limit(limit).lean(),
  ])
  return ok(res, { enquiries: enquiries.map(enquiryResponse) }, 'Enquiries retrieved.', 200, paginate(total, page, limit))
}

async function getEnquiry(req, res) {
  if (!isObjectId(req.params.id)) return sendError(res, 'Enquiry not found.', 404)
  const enquiry = await Enquiry.findOne(buyerEnquiryQuery(req, req.params.id)).populate('seller_company_id', 'name city state').populate('product_id', 'code name image_urls').lean()
  if (!enquiry) return sendError(res, 'Enquiry not found.', 404)
  return ok(res, enquiryResponse(enquiry), 'Enquiry retrieved.')
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
  const enquiry = await Enquiry.findOne(buyerEnquiryQuery(req, req.params.id)).select('_id').lean()
  if (!enquiry) return sendError(res, 'Enquiry not found.', 404)
  const messages = await EnquiryMessage.find({ enquiry_id: enquiry._id }).populate('sender_user_id', 'name role').sort({ created_at: 1 }).lean()
  return ok(res, { messages: messages.map(item => ({
    id: item._id, message: item.message, sender_side: item.sender_side,
    sender: item.sender_user_id ? { id: item.sender_user_id._id, name: item.sender_user_id.name } : null,
    client_message_id: item.client_message_id || '', created_at: item.created_at,
  })) }, 'Messages retrieved.')
}

async function createBuyerMessage(req, res) {
  const message = String(req.body.message || '').trim()
  const clientMessageId = String(req.body.client_message_id || '').trim()
  if (!message || message.length > 2000) return sendError(res, 'message is required and must not exceed 2000 characters.', 400)
  const enquiry = await Enquiry.findOne(buyerEnquiryQuery(req, req.params.id)).lean()
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

  const product = await Product.findOne({ _id: enquiry.product_id, company_id: req.user.company_id }).select('gst_percent').lean()
  if (!product) return sendError(res, 'Product not found for this seller.', 404)
  const unitPrice = nonNegative(req.body.unit_price, 'unit_price')
  if (unitPrice <= 0) return sendError(res, 'unit_price must be greater than zero.', 400)
  const transport = nonNegative(req.body.transport_charge, 'transport_charge')
  const packing = nonNegative(req.body.packing_charge, 'packing_charge')
  const other = nonNegative(req.body.other_charge, 'other_charge')
  const gstPercent = req.body.gst_percent === undefined ? nonNegative(product.gst_percent, 'gst_percent') : nonNegative(req.body.gst_percent, 'gst_percent')
  if (gstPercent > 100) return sendError(res, 'gst_percent must not exceed 100.', 400)
  const amount = money(enquiry.qty * unitPrice)
  const gstAmount = money(amount * gstPercent / 100)
  const total = money(amount + gstAmount + transport + packing + other)

  await EnquiryOffer.updateMany({ enquiry_id: enquiry._id, seller_company_id: req.user.company_id, status: 'Pending' }, { status: 'Withdrawn' })
  const offer = await EnquiryOffer.create({
    enquiry_id: enquiry._id, buyer_company_id: enquiry.buyer_company_id, buyer_user_id: enquiry.buyer_user_id,
    seller_company_id: req.user.company_id, seller_user_id: req.user._id, product_id: enquiry.product_id,
    qty: enquiry.qty, unit: enquiry.unit, unit_price: unitPrice, gst_percent: gstPercent,
    amount, gst_amount: gstAmount, transport_charge: transport, packing_charge: packing,
    other_charge: other, total_amount: total, notes: String(req.body.notes || '').trim().slice(0, 2000),
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
  return ok(res, { messages }, 'Messages retrieved.')
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
  const order = await Order.findOne(buyerOrderQuery(req, req.params.id)).select('-purchase_rate -purchase_cost -warehouse_status').populate('seller_company_id', 'name city state').populate('product_id', 'code name image_urls').lean()
  if (!order) return sendError(res, 'Order not found.', 404)
  return ok(res, orderResponse(order), 'Order retrieved.')
}

async function cancelOrder(req, res) {
  const cancellable = ['New', 'Pending Approval', 'Approved']
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
  const order = await Order.findOne(buyerOrderQuery(req, req.params.id)).select('order_code status status_history dispatch_id seller_company_id').lean()
  if (!order) return sendError(res, 'Order not found.', 404)
  const dispatch = order.dispatch_id
    ? await Dispatch.findOne({ _id: order.dispatch_id, order_id: order._id, company_id: order.seller_company_id }).select('dispatch_code invoice_number vehicle_number transport_name lr_number dispatch_date expected_delivery_days expected_delivery delivered_date status updated_at').lean()
    : null
  return ok(res, {
    order_id: order._id,
    order_code: order.order_code,
    status: ANDROID_STATUS[order.status] || 'Processing',
    internal_status: order.status,
    history: (order.status_history || []).map(item => ({ status: ANDROID_STATUS[item.status] || 'Processing', internal_status: item.status, remarks: item.remarks || '', timestamp: item.timestamp })),
    dispatch: dispatch ? {
      dispatch_code: dispatch.dispatch_code || '', invoice_number: dispatch.invoice_number || '',
      vehicle_number: dispatch.vehicle_number || '', transport_name: dispatch.transport_name || '',
      lr_number: dispatch.lr_number || '', dispatch_date: dispatch.dispatch_date,
      expected_delivery_days: dispatch.expected_delivery_days, expected_delivery: dispatch.expected_delivery,
      delivered_date: dispatch.delivered_date, status: dispatch.status, updated_at: dispatch.updated_at,
    } : null,
    capabilities: { live_gps_tracking: false },
  }, 'Tracking retrieved.')
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

module.exports = {
  ANDROID_STATUS,
  dashboard,
  listProducts,
  getProduct,
  createEnquiry,
  listEnquiries,
  getEnquiry,
  cancelEnquiry,
  listMessages,
  createBuyerMessage,
  listOffers,
  respondToOffer,
  sellerListOffers,
  sellerCreateOffer,
  sellerListMessages,
  sellerCreateMessage,
  createOrder,
  listOrders,
  getOrder,
  cancelOrder,
  tracking,
  listNotifications,
  readNotification,
  readAllNotifications,
}
