const mongoose = require('mongoose')
const { sendSuccess, sendError, paginate } = require('../utils/helpers')
const { Notification } = require('../models')

// ─────────────────────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────────────────────

async function listNotifications(req, res) {
  const { is_read, page = 1, limit = 30 } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)
  const [total, notifications, unreadCount] = await Promise.all([
    Notification.count(req.user.company_id, { is_read }),
    Notification.findAll(req.user.company_id, { is_read, limit: parseInt(limit), offset }),
    Notification.getUnreadCount(req.user.company_id),
  ])
  sendSuccess(res, { notifications, unreadCount, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

async function markNotificationRead(req, res) {
  const notif = await Notification.markRead(req.params.id, req.user.company_id)
  if (!notif) return sendError(res, 'Notification not found.', 404)
  sendSuccess(res, notif, 'Notification marked as read.')
}

async function markAllNotificationsRead(req, res) {
  const count = await Notification.markAllRead(req.user.company_id)
  sendSuccess(res, { updated: count }, 'All notifications marked as read.')
}

async function deleteNotification(req, res) {
  const deleted = await Notification.delete(req.params.id, req.user.company_id)
  if (!deleted) return sendError(res, 'Notification not found.', 404)
  sendSuccess(res, null, 'Notification deleted.')
}

// ─────────────────────────────────────────────────────────────
// DOCUMENTS
// ─────────────────────────────────────────────────────────────

const documentSchema = new mongoose.Schema({
  company_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  entity_type: { type: String, default: '' },
  entity_id:   { type: String, default: '' },
  doc_type:    { type: String, default: '' },
  file_name:   { type: String, default: '' },
  file_url:    { type: String, default: '' },
  file_size:   { type: Number, default: 0 },
  mime_type:   { type: String, default: '' },
  uploaded_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: { createdAt: 'created_at' } })

documentSchema.index({ company_id: 1, entity_type: 1 })
const DocumentModel = mongoose.models.Document || mongoose.model('Document', documentSchema)

async function listDocuments(req, res) {
  const { entity_type, entity_id, page = 1, limit = 30 } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)
  const query  = { company_id: req.user.company_id }
  if (entity_type) query.entity_type = entity_type
  if (entity_id)   query.entity_id   = entity_id

  const [total, documents] = await Promise.all([
    DocumentModel.countDocuments(query),
    DocumentModel.find(query)
      .populate('uploaded_by', 'name')
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(parseInt(limit))
      .lean(),
  ])

  sendSuccess(res, { documents, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

async function uploadDocument(req, res) {
  const { entity_type, entity_id, doc_type } = req.body
  if (!req.files || req.files.length === 0) return sendError(res, 'No files uploaded.')
  if (!entity_type) return sendError(res, 'entity_type is required.')

  const inserted = []
  for (const file of req.files) {
    const doc = await DocumentModel.create({
      company_id:  req.user.company_id,
      entity_type,
      entity_id:   entity_id || '',
      doc_type:    doc_type  || '',
      file_name:   file.filename,
      file_url:    `/uploads/documents/${file.filename}`,
      file_size:   file.size,
      mime_type:   file.mimetype,
      uploaded_by: req.user._id,
    })
    inserted.push(doc.toObject())
  }

  sendSuccess(res, { documents: inserted }, `${inserted.length} file(s) uploaded.`, 201)
}

async function deleteDocument(req, res) {
  const result = await DocumentModel.deleteOne({ _id: req.params.id, company_id: req.user.company_id })
  if (result.deletedCount === 0) return sendError(res, 'Document not found.', 404)
  sendSuccess(res, null, 'Document deleted.')
}

// ─────────────────────────────────────────────────────────────
// SUBSCRIPTIONS
// ─────────────────────────────────────────────────────────────

const subscriptionSchema = new mongoose.Schema({
  company_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  plan:        { type: String, required: true },
  starts_at:   { type: Date, required: true },
  expires_at:  { type: Date, required: true },
  amount_paid: { type: Number, default: 0 },
  payment_ref: { type: String, default: '' },
  status:      { type: String, default: 'Active' },
}, { timestamps: { createdAt: 'created_at' } })

subscriptionSchema.index({ company_id: 1 })
const SubscriptionModel = mongoose.models.Subscription || mongoose.model('Subscription', subscriptionSchema)

async function listSubscriptions(req, res) {
  const subs = await SubscriptionModel.find({ company_id: req.user.company_id })
    .populate('company_id', 'name')
    .sort({ created_at: -1 })
    .lean()
  sendSuccess(res, subs)
}

async function createSubscription(req, res) {
  const { plan, starts_at, expires_at, amount_paid, payment_ref } = req.body
  if (!plan || !starts_at || !expires_at) {
    return sendError(res, 'plan, starts_at and expires_at are required.')
  }

  const { CompanyModel } = require('../models/Company')

  const sub = await SubscriptionModel.create({
    company_id: req.user.company_id,
    plan, starts_at, expires_at,
    amount_paid: amount_paid || 0,
    payment_ref: payment_ref || '',
    status: 'Active',
  })

  // Update company plan
  await CompanyModel.findByIdAndUpdate(req.user.company_id, { subscription_plan: plan })

  sendSuccess(res, sub.toObject(), 'Subscription created.', 201)
}

async function cancelSubscription(req, res) {
  const sub = await SubscriptionModel.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    { status: 'Cancelled' },
    { new: true }
  ).lean()
  if (!sub) return sendError(res, 'Subscription not found.', 404)
  sendSuccess(res, sub, 'Subscription cancelled.')
}

// ─────────────────────────────────────────────────────────────
// DASHBOARD ANALYTICS
// ─────────────────────────────────────────────────────────────

async function getDashboardStats(req, res) {
  const cid = new mongoose.Types.ObjectId(req.user.company_id)

  const { CustomerModel }  = require('../models/Customer')
  const { ProductModel }   = require('../models/Product')
  const { EnquiryModel }   = require('../models/Enquiry')
  const { OrderModel }     = require('../models/Order')
  const { DispatchModel }  = require('../models/Dispatch')
  const { SaleModel }      = require('../models/Sale')
  const { InventoryModel } = require('../models/Inventory')
  const { ReceivableModel } = require('../models/Payment')

  const today     = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow  = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const yearStart  = new Date(today.getFullYear(), 0, 1)

  const [
    totalCustomers, totalProducts, totalEnquiries, totalOrders,
    totalDispatches, pendingOrders, lowStockCount,
    totalOutstanding, todaySales, monthSales, yearSales,
    topProducts, topCustomers, recentEnquiries, salesTrendRaw,
  ] = await Promise.all([
    CustomerModel.countDocuments({ company_id: cid }),
    ProductModel.countDocuments({ company_id: cid, is_active: true }),
    EnquiryModel.countDocuments({ company_id: cid }),
    OrderModel.countDocuments({ company_id: cid }),
    DispatchModel.countDocuments({ company_id: cid }),
    OrderModel.countDocuments({ company_id: cid, status: { $in: [
      'New', 'Pending Approval', 'Approved',
      'Picking Started', 'Picking Completed',
      'Sorting Started', 'Sorting Completed',
      'Packing Started', 'Packing Completed',
      'Invoice Generated', 'Ready for Dispatch',
      'Dispatched', 'In Transit',
    ] } }),
    InventoryModel.countDocuments({ company_id: cid, $expr: { $lte: ['$current_stock', '$low_stock_alert'] } }),
    ReceivableModel.aggregate([
      { $match: { company_id: cid, status: { $ne: 'Received' } } },
      { $group: { _id: null, total: { $sum: '$outstanding' } } },
    ]),
    SaleModel.aggregate([
      { $match: { company_id: cid, sale_date: { $gte: today, $lt: tomorrow } } },
      { $group: { _id: null, total: { $sum: '$total_amount' } } },
    ]),
    SaleModel.aggregate([
      { $match: { company_id: cid, sale_date: { $gte: monthStart } } },
      { $group: { _id: null, total: { $sum: '$total_amount' } } },
    ]),
    SaleModel.aggregate([
      { $match: { company_id: cid, sale_date: { $gte: yearStart } } },
      { $group: { _id: null, total: { $sum: '$total_amount' } } },
    ]),
    SaleModel.aggregate([
      { $match: { company_id: cid } },
      { $group: { _id: '$product_id', total_qty: { $sum: '$qty' }, total_sales: { $sum: '$total_amount' } } },
      { $sort: { total_sales: -1 } },
      { $limit: 5 },
      { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'product' } },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      { $project: { name: '$product.name', code: '$product.code', total_qty: 1, total_sales: 1 } },
    ]),
    SaleModel.aggregate([
      { $match: { company_id: cid } },
      { $group: { _id: '$customer_id', order_count: { $sum: 1 }, total_sales: { $sum: '$total_amount' } } },
      { $sort: { total_sales: -1 } },
      { $limit: 5 },
      { $lookup: { from: 'customers', localField: '_id', foreignField: '_id', as: 'customer' } },
      { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
      { $project: { name: '$customer.name', mobile: '$customer.mobile', order_count: 1, total_sales: 1 } },
    ]),
    EnquiryModel.find({ company_id: cid })
      .select('enq_code retailer_name product_name qty unit status created_at')
      .sort({ created_at: -1 })
      .limit(5)
      .lean(),
    // ── 12-month sales + purchase trend ──────────────────────
    SaleModel.aggregate([
      { $match: { company_id: cid, sale_date: { $gte: new Date(new Date().getFullYear(), new Date().getMonth() - 11, 1) } } },
      { $group: { _id: { year: { $year: '$sale_date' }, month: { $month: '$sale_date' } }, sales: { $sum: '$total_amount' } } },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
      { $project: { _id: 0, year: '$_id.year', month: '$_id.month', sales: 1 } },
    ]),
  ])

  // Build 12-month trend combining sales + purchases
  const { PurchaseModel } = require('../models/Purchase')
  const purchaseTrendRaw = await PurchaseModel.aggregate([
    { $match: { company_id: cid, purchase_date: { $gte: new Date(new Date().getFullYear(), new Date().getMonth() - 11, 1) } } },
    { $group: { _id: { year: { $year: '$purchase_date' }, month: { $month: '$purchase_date' } }, purchase: { $sum: '$total_amount' } } },
    { $sort: { '_id.year': 1, '_id.month': 1 } },
    { $project: { _id: 0, year: '$_id.year', month: '$_id.month', purchase: 1 } },
  ])

  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const now = new Date()
  const trend = []
  for (let i = 11; i >= 0; i--) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const yr  = d.getFullYear()
    const mo  = d.getMonth() + 1
    const sRow = salesTrendRaw.find(r => r.year === yr && r.month === mo)
    const pRow = purchaseTrendRaw.find(r => r.year === yr && r.month === mo)
    const s = sRow?.sales    || 0
    const p = pRow?.purchase || 0
    trend.push({ month: `${MONTH_NAMES[mo - 1]} ${String(yr).slice(2)}`, sales: s, purchase: p, profit: s - p })
  }

  sendSuccess(res, {
    totalCustomers,
    totalProducts,
    totalEnquiries,
    totalOrders,
    totalDispatches,
    pendingOrders,
    lowStockCount,
    totalOutstanding:  totalOutstanding[0]?.total || 0,
    todaySales:        todaySales[0]?.total        || 0,
    monthSales:        monthSales[0]?.total        || 0,
    yearSales:         yearSales[0]?.total         || 0,
    topProducts,
    topCustomers,
    recentEnquiries,
    trend,
  })
}

// ─────────────────────────────────────────────────────────────
// REPORT CENTER
// ─────────────────────────────────────────────────────────────

async function getSalesReport(req, res) {
  const { from_date, to_date, group_by = 'day' } = req.query
  const cid      = new mongoose.Types.ObjectId(req.user.company_id)
  const fromDate = new Date(from_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const toDate   = new Date(to_date   || new Date())

  const { SaleModel } = require('../models/Sale')

  const groupId = group_by === 'month'
    ? { year: { $year: '$sale_date' }, month: { $month: '$sale_date' } }
    : { year: { $year: '$sale_date' }, month: { $month: '$sale_date' }, day: { $dayOfMonth: '$sale_date' } }

  const [rows, totalsAgg] = await Promise.all([
    SaleModel.aggregate([
      { $match: { company_id: cid, sale_date: { $gte: fromDate, $lte: toDate } } },
      { $group: {
        _id:          groupId,
        total_sales:  { $sum: '$total_amount' },
        base_amount:  { $sum: '$amount' },
        total_gst:    { $sum: '$gst_amount' },
        order_count:  { $sum: 1 },
        period_date:  { $min: '$sale_date' },
      }},
      { $sort: { period_date: 1 } },
      { $project: {
        period:      { $dateToString: { format: group_by === 'month' ? '%b %Y' : '%Y-%m-%d', date: '$period_date' } },
        total_sales: 1, base_amount: 1, total_gst: 1, order_count: 1,
      }},
    ]),
    SaleModel.aggregate([
      { $match: { company_id: cid, sale_date: { $gte: fromDate, $lte: toDate } } },
      { $group: { _id: null, total: { $sum: '$total_amount' }, total_gst: { $sum: '$gst_amount' }, count: { $sum: 1 } } },
    ]),
  ])

  sendSuccess(res, {
    rows,
    totals: totalsAgg[0] || { total: 0, total_gst: 0, count: 0 },
    period: { from: fromDate, to: toDate },
  })
}

async function getPurchaseReport(req, res) {
  const { from_date, to_date } = req.query
  const cid      = new mongoose.Types.ObjectId(req.user.company_id)
  const fromDate = new Date(from_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const toDate   = new Date(to_date   || new Date())

  const { PurchaseModel } = require('../models/Purchase')

  const [rows, totalsAgg] = await Promise.all([
    PurchaseModel.aggregate([
      { $match: { company_id: cid, purchase_date: { $gte: fromDate, $lte: toDate } } },
      { $group: { _id: '$supplier_name', count: { $sum: 1 }, total: { $sum: '$total_amount' } } },
      { $project: { supplier_name: '$_id', count: 1, total: 1, _id: 0 } },
      { $sort: { total: -1 } },
    ]),
    PurchaseModel.aggregate([
      { $match: { company_id: cid, purchase_date: { $gte: fromDate, $lte: toDate } } },
      { $group: { _id: null, total: { $sum: '$total_amount' }, count: { $sum: 1 } } },
    ]),
  ])

  sendSuccess(res, {
    rows,
    totals: totalsAgg[0] || { total: 0, count: 0 },
    period: { from: fromDate, to: toDate },
  })
}

async function getExpenseReport(req, res) {
  const { from_date, to_date } = req.query
  const cid      = new mongoose.Types.ObjectId(req.user.company_id)
  const fromDate = new Date(from_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const toDate   = new Date(to_date   || new Date())

  const { ExpenseModel } = require('../models/Expense')

  const [rows, totalsAgg] = await Promise.all([
    ExpenseModel.aggregate([
      { $match: { company_id: cid, expense_date: { $gte: fromDate, $lte: toDate } } },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $project: { category: '$_id', total: 1, count: 1, _id: 0 } },
      { $sort: { total: -1 } },
    ]),
    ExpenseModel.aggregate([
      { $match: { company_id: cid, expense_date: { $gte: fromDate, $lte: toDate } } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
  ])

  sendSuccess(res, {
    rows,
    totals: totalsAgg[0] || { total: 0, count: 0 },
    period: { from: fromDate, to: toDate },
  })
}

module.exports = {
  listNotifications, markNotificationRead, markAllNotificationsRead, deleteNotification,
  listDocuments, uploadDocument, deleteDocument,
  listSubscriptions, createSubscription, cancelSubscription,
  getDashboardStats,
  getSalesReport, getPurchaseReport, getExpenseReport,
}
