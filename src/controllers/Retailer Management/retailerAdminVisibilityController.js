/**
 * Retailer Admin — Cross-company visibility + company lifecycle (Super Admin only)
 *
 * Mirrors the wholesaler admin pattern (wholesalerAdminVisibilityController):
 *   • companies, users, orders, enquiries across ALL retailer companies
 *   • approve / reject / suspend / reinstate a retailer company
 *   • KYC document status for a retailer company
 *
 * These are the admin-facing endpoints consumed by the CRM RetailerManagement page.
 */
const Company     = require('../../models/Company Management/Company')
const Product     = require('../../models/Product Management/Product')
const Order       = require('../../models/Marketplace Management/Order')
const Enquiry     = require('../../models/Marketplace Management/Enquiry')
const User        = require('../../models/User Management/User')
// ── ERP + CRM collections the retailer app writes ─────────────
const Sale        = require('../../models/Finance Management/Sale')
const Expense     = require('../../models/Finance Management/Expense')
const Transaction = require('../../models/Finance Management/Transaction')
const Invoice     = require('../../models/Finance Management/Invoice')
const Quotation   = require('../../models/Finance Management/Quotation')
const Receivable  = require('../../models/Finance Management/Receivable')
const Payable     = require('../../models/Finance Management/Payable')
const Purchase    = require('../../models/Purchase & Inventory Management/Purchase')
const Inventory   = require('../../models/Purchase & Inventory Management/Inventory')
const Dispatch    = require('../../models/Marketplace Management/Dispatch')
const Customer    = require('../../models/CRM Management/Customer')
const Lead        = require('../../models/CRM Management/Lead')
const Followup    = require('../../models/CRM Management/Followup')
const { sendSuccess, sendError, paginate } = require('../../utils/helpers')

// ── Guard ────────────────────────────────────────────────────
function ensureSuperAdmin(req, res) {
  if (req.user.role !== 'Super Admin') {
    sendError(res, 'Access denied. Super Admin only.', 403)
    return false
  }
  return true
}

// Flatten a populated company_id into company_name / company_code / company_id
function withCompany(rows) {
  return rows.map(r => ({
    ...r,
    company_name: r.company_id?.name || '—',
    company_code: r.company_id?.company_code || '',
    company_id:   r.company_id?._id || r.company_id,
  }))
}

// Retailer companies are Company docs with biz_type 'Retailer'.
// Match case-insensitively so legacy values ("Retailers", "retailer") are not missed.
const RETAILER_FILTER = { biz_type: /^retailers?$/i }

// All retailer company ids (used to scope cross-company data reads).
async function retailerCompanyIds() {
  const rows = await Company.find(RETAILER_FILTER).select('_id').lean()
  return rows.map(r => r._id)
}

/**
 * Filter capturing everything produced BY the retailer app for a set of retailer
 * company ids. An order/enquiry may reference a retailer as the owning company,
 * the buyer company, the seller company, or (most reliably) by the app
 * provenance stamp the mobile app writes: created_by_type === 'Retailer App'.
 */
function retailerAppDataFilter(companyIds) {
  const ors = [{ created_by_type: 'Retailer App' }]
  if (companyIds && companyIds.length) {
    ors.push({ company_id:      { $in: companyIds } })
    ors.push({ buyer_company_id: { $in: companyIds } })
    ors.push({ seller_company_id:{ $in: companyIds } })
  }
  return { $or: ors }
}

// ── Companies ────────────────────────────────────────────────

// GET /api/retailer/admin/companies
async function listCompanies(req, res) {
  if (!ensureSuperAdmin(req, res)) return
  try {
    const { page = 1, limit = 200, status, search } = req.query
    const skip = (parseInt(page) - 1) * parseInt(limit)
    const query = { ...RETAILER_FILTER }
    if (status && status !== 'All') query.status = status
    if (search) {
      query.$or = [
        { name:         { $regex: search, $options: 'i' } },
        { owner_name:   { $regex: search, $options: 'i' } },
        { mobile:       { $regex: search, $options: 'i' } },
        { email:        { $regex: search, $options: 'i' } },
        { company_code: { $regex: search, $options: 'i' } },
      ]
    }
    const [total, rows] = await Promise.all([
      Company.countDocuments(query),
      Company.find(query).sort({ created_at: -1 }).skip(skip).limit(parseInt(limit)).lean(),
    ])
    sendSuccess(res, {
      companies: rows,
      pagination: paginate(total, parseInt(page), parseInt(limit)),
    })
  } catch (e) {
    sendError(res, e.message, 500)
  }
}

// GET /api/retailer/admin/companies/:id
async function getCompany(req, res) {
  if (!ensureSuperAdmin(req, res)) return
  try {
    const company = await Company.findOne({ _id: req.params.id, ...RETAILER_FILTER }).lean()
    if (!company) return sendError(res, 'Retailer company not found.', 404)

    const ids = [company._id]
    const [userCount, orderCount, enquiryCount] = await Promise.all([
      User.countDocuments({ company_id: { $in: ids } }),
      Order.countDocuments(retailerAppDataFilter(ids)),
      Enquiry.countDocuments(retailerAppDataFilter(ids)),
    ])

    sendSuccess(res, { company, stats: { users: userCount, orders: orderCount, enquiries: enquiryCount } })
  } catch (e) {
    sendError(res, e.message, 500)
  }
}

// PATCH /api/retailer/admin/companies/:id/approve
async function approveCompany(req, res) {
  if (!ensureSuperAdmin(req, res)) return
  try {
    const company = await Company.findOneAndUpdate(
      { _id: req.params.id, ...RETAILER_FILTER },
      { status: 'Approved', is_active: true, reject_reason: '', approved_at: new Date(), approved_by: req.user._id },
      { new: true }
    ).lean()
    if (!company) return sendError(res, 'Retailer company not found.', 404)
    sendSuccess(res, { company }, 'Retailer approved.')
  } catch (e) {
    sendError(res, e.message, 500)
  }
}

// PATCH /api/retailer/admin/companies/:id/reject
async function rejectCompany(req, res) {
  if (!ensureSuperAdmin(req, res)) return
  try {
    const reason = String(req.body?.reason || '').trim()
    const company = await Company.findOneAndUpdate(
      { _id: req.params.id, ...RETAILER_FILTER },
      { status: 'Rejected', reject_reason: reason, rejected_at: new Date(), reviewed_by: req.user._id },
      { new: true }
    ).lean()
    if (!company) return sendError(res, 'Retailer company not found.', 404)
    sendSuccess(res, { company }, 'Retailer rejected.')
  } catch (e) {
    sendError(res, e.message, 500)
  }
}

// PATCH /api/retailer/admin/companies/:id/suspend
async function suspendCompany(req, res) {
  if (!ensureSuperAdmin(req, res)) return
  try {
    const reason = String(req.body?.reason || '').trim()
    const existing = await Company.findOne({ _id: req.params.id, ...RETAILER_FILTER }).lean()
    if (!existing) return sendError(res, 'Retailer company not found.', 404)

    const company = await Company.findOneAndUpdate(
      { _id: req.params.id, ...RETAILER_FILTER },
      { status: 'Suspended', prev_status: existing.status, suspend_reason: reason, reviewed_by: req.user._id },
      { new: true }
    ).lean()
    sendSuccess(res, { company }, 'Retailer suspended.')
  } catch (e) {
    sendError(res, e.message, 500)
  }
}

// PATCH /api/retailer/admin/companies/:id/reinstate
async function reinstateCompany(req, res) {
  if (!ensureSuperAdmin(req, res)) return
  try {
    const existing = await Company.findOne({ _id: req.params.id, ...RETAILER_FILTER }).lean()
    if (!existing) return sendError(res, 'Retailer company not found.', 404)

    const restoreTo = existing.prev_status && existing.prev_status !== 'Suspended' ? existing.prev_status : 'Approved'
    const company = await Company.findOneAndUpdate(
      { _id: req.params.id, ...RETAILER_FILTER },
      { status: restoreTo, suspend_reason: '', prev_status: '' },
      { new: true }
    ).lean()
    sendSuccess(res, { company }, 'Retailer reinstated.')
  } catch (e) {
    sendError(res, e.message, 500)
  }
}

// GET /api/retailer/admin/companies/:id/kyc
async function getCompanyKyc(req, res) {
  if (!ensureSuperAdmin(req, res)) return
  try {
    const company = await Company.findOne({ _id: req.params.id, ...RETAILER_FILTER })
      .select('name company_code docs_gst docs_pan docs_address docs_biz kyc_documents'
        + ' doc_gst_url doc_pan_url doc_reg_url doc_trade_url')
      .lean()
    if (!company) return sendError(res, 'Retailer company not found.', 404)

    const documents = (company.kyc_documents || []).map(d => ({
      document_type: d.document_type,
      file_url:      d.file_url,
      status:        d.status,
      reject_reason: d.reject_reason || '',
      uploaded_at:   d.uploaded_at,
      reviewed_at:   d.reviewed_at,
    }))

    sendSuccess(res, {
      company_id: company._id,
      company_name: company.name,
      company_code: company.company_code || '',
      flags: {
        gst:         !!company.docs_gst,
        pan:         !!company.docs_pan,
        address:     !!company.docs_address,
        business:    !!company.docs_biz,
      },
      documents,
    })
  } catch (e) {
    sendError(res, e.message, 500)
  }
}

// ── Cross-company data ───────────────────────────────────────

// GET /api/retailer/admin/users — retailer-app users across all companies
async function listUsers(req, res) {
  if (!ensureSuperAdmin(req, res)) return
  try {
    const { page = 1, limit = 200, search } = req.query
    const skip = (parseInt(page) - 1) * parseInt(limit)

    const companyIds = await retailerCompanyIds()
    // Retailer owner + staff accounts (by company, or by retailer role).
    const query = {
      $or: [
        { company_id: { $in: companyIds } },
        { role: { $in: ['Retailer', 'RetailerStaff'] } },
      ],
    }
    if (search) {
      query.$and = [{
        $or: [
          { name:   { $regex: search, $options: 'i' } },
          { email:  { $regex: search, $options: 'i' } },
          { mobile: { $regex: search, $options: 'i' } },
        ],
      }]
    }
    const [total, rows] = await Promise.all([
      User.countDocuments(query),
      User.find(query)
        .select('name email mobile role is_active company_id last_login created_at')
        .populate('company_id', 'name company_code')
        .sort({ created_at: -1 })
        .skip(skip).limit(parseInt(limit)).lean(),
    ])
    sendSuccess(res, { users: withCompany(rows), pagination: paginate(total, parseInt(page), parseInt(limit)) })
  } catch (e) {
    sendError(res, e.message, 500)
  }
}

// GET /api/retailer/admin/orders — retailer orders across all companies
async function listOrders(req, res) {
  if (!ensureSuperAdmin(req, res)) return
  try {
    const { page = 1, limit = 200, status, search } = req.query
    const skip = (parseInt(page) - 1) * parseInt(limit)

    const companyIds = await retailerCompanyIds()
    const query = retailerAppDataFilter(companyIds)
    if (status && status !== 'All') query.status = status
    if (search) {
      query.$and = [{
        $or: [
          { customer_name: { $regex: search, $options: 'i' } },
          { order_code:    { $regex: search, $options: 'i' } },
          { product_name:  { $regex: search, $options: 'i' } },
        ],
      }]
    }
    const [total, rows] = await Promise.all([
      Order.countDocuments(query),
      Order.find(query)
        .populate('company_id', 'name company_code')
        .populate('buyer_company_id', 'name company_code')
        .sort({ created_at: -1 })
        .skip(skip).limit(parseInt(limit)).lean(),
    ])
    const mapped = rows.map(r => {
      const own = r.company_id
      const buyer = r.buyer_company_id
      const ownIsRetailer = own && companyIds.some(id => String(id) === String(own._id))
      const display = ownIsRetailer ? own : (buyer || own)
      return {
        ...r,
        company_name: display?.name || r.created_by_company || '—',
        company_code: display?.company_code || '',
        company_id:   display?._id || r.company_id,
      }
    })
    sendSuccess(res, { orders: mapped, pagination: paginate(total, parseInt(page), parseInt(limit)) })
  } catch (e) {
    sendError(res, e.message, 500)
  }
}

// GET /api/retailer/admin/enquiries — retailer enquiries across all companies
async function listEnquiries(req, res) {
  if (!ensureSuperAdmin(req, res)) return
  try {
    const { page = 1, limit = 200, status, search } = req.query
    const skip = (parseInt(page) - 1) * parseInt(limit)

    const companyIds = await retailerCompanyIds()
    const query = retailerAppDataFilter(companyIds)
    if (status && status !== 'All') query.status = status
    if (search) {
      query.$and = [{
        $or: [
          { retailer_name: { $regex: search, $options: 'i' } },
          { product_name:  { $regex: search, $options: 'i' } },
          { enq_code:      { $regex: search, $options: 'i' } },
        ],
      }]
    }
    const [total, rows] = await Promise.all([
      Enquiry.countDocuments(query),
      Enquiry.find(query)
        .populate('company_id', 'name company_code')
        .populate('buyer_company_id', 'name company_code')
        .sort({ created_at: -1 })
        .skip(skip).limit(parseInt(limit)).lean(),
    ])
    const mapped = rows.map(r => {
      const own = r.company_id
      const buyer = r.buyer_company_id
      const ownIsRetailer = own && companyIds.some(id => String(id) === String(own._id))
      const display = ownIsRetailer ? own : (buyer || own)
      return {
        ...r,
        company_name: display?.name || r.retailer_name || '—',
        company_code: display?.company_code || '',
        company_id:   display?._id || r.company_id,
      }
    })
    sendSuccess(res, { enquiries: mapped, pagination: paginate(total, parseInt(page), parseInt(limit)) })
  } catch (e) {
    sendError(res, e.message, 500)
  }
}

// GET /api/retailer/admin/products — retailer-owned products across all companies
async function listProducts(req, res) {
  if (!ensureSuperAdmin(req, res)) return
  try {
    const { page = 1, limit = 200, search } = req.query
    const skip = (parseInt(page) - 1) * parseInt(limit)

    const companyIds = await retailerCompanyIds()
    // Products owned by a retailer company OR created by a retailer user.
    const query = {
      status: { $ne: 'deleted' },
      $or: [
        { company_id: { $in: companyIds } },
        { created_by_type: 'Retailer' },
        { source: 'retailer' },
      ],
    }
    if (search) {
      query.$and = [{
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { code: { $regex: search, $options: 'i' } },
        ],
      }]
    }
    const [total, rows] = await Promise.all([
      Product.countDocuments(query),
      Product.find(query)
        .populate('company_id', 'name company_code')
        .sort({ created_at: -1 })
        .skip(skip).limit(parseInt(limit)).lean(),
    ])
    sendSuccess(res, { products: withCompany(rows), pagination: paginate(total, parseInt(page), parseInt(limit)) })
  } catch (e) {
    sendError(res, e.message, 500)
  }
}

// ── Generic cross-company lister for retailer-owned collections ──────────────
//
// Every retailer ERP/CRM write goes through a shared controller that sets
// `company_id: req.user.company_id` (verified 2026-09-29 — sale, expense,
// purchase, transaction, invoice, quotation, dispatch, customer, lead, followup,
// inventory all carry a required `company_id`). So `company_id: { $in:
// retailerCompanyIds() }` is the reliable scope for everything the retailer app
// produces, and no provenance stamp is needed.
//
// This factory exists because the alternative is eleven near-identical functions
// that drift apart. Each collection differs only in: model, response key,
// sort, the field the `status` filter maps to, the fields search matches, and
// any populate.
function companyScopedLister({
  Model, key,
  sort = { created_at: -1 },
  statusField = 'status',
  searchFields = [],
  populate = [],
  extraFilter = null,
}) {
  return async function listForAdmin(req, res) {
    if (!ensureSuperAdmin(req, res)) return
    try {
      const { page = 1, limit = 200, search, status } = req.query
      const skip = (parseInt(page) - 1) * parseInt(limit)

      const companyIds = await retailerCompanyIds()
      const query = { company_id: { $in: companyIds } }

      // A few collections are keyed differently (Sale uses sale_status) or need a
      // fixed extra condition — let the caller inject it.
      if (extraFilter) Object.assign(query, extraFilter(req.query) || {})

      if (status && status !== 'All' && statusField) query[statusField] = status
      if (search && searchFields.length) {
        query.$and = [{
          $or: searchFields.map(f => ({ [f]: { $regex: search, $options: 'i' } })),
        }]
      }

      let cursor = Model.find(query)
      populate.forEach(p => { cursor = cursor.populate(p.path, p.select) })
      const [total, rows] = await Promise.all([
        Model.countDocuments(query),
        cursor.sort(sort).skip(skip).limit(parseInt(limit)).lean(),
      ])

      sendSuccess(res, {
        [key]: withCompany(rows),
        pagination: paginate(total, parseInt(page), parseInt(limit)),
      })
    } catch (e) {
      sendError(res, e.message, 500)
    }
  }
}

const COMPANY_POP = { path: 'company_id', select: 'name company_code' }

// GET /api/retailer/admin/sales
const listSales = companyScopedLister({
  Model: Sale, key: 'sales', statusField: 'sale_status',
  searchFields: ['sale_code', 'customer_name', 'product_name', 'invoice_number'],
  populate: [COMPANY_POP],
})

// GET /api/retailer/admin/purchases
const listPurchases = companyScopedLister({
  Model: Purchase, key: 'purchases', statusField: 'status',
  searchFields: ['purchase_code', 'supplier_name', 'product_name', 'invoice_number'],
  populate: [COMPANY_POP],
})

// GET /api/retailer/admin/expenses
const listExpenses = companyScopedLister({
  Model: Expense, key: 'expenses', statusField: null,   // no status field on Expense
  sort: { expense_date: -1, created_at: -1 },
  searchFields: ['category', 'description', 'reference'],
  populate: [COMPANY_POP],
})

// GET /api/retailer/admin/transactions — money actually received/paid
const listTransactions = companyScopedLister({
  Model: Transaction, key: 'transactions', statusField: 'type',  // Received | Paid
  sort: { txn_date: -1, created_at: -1 },
  searchFields: ['txn_code', 'party_name', 'reference', 'notes'],
  populate: [COMPANY_POP],
})

// GET /api/retailer/admin/invoices
const listInvoices = companyScopedLister({
  Model: Invoice, key: 'invoices', statusField: 'status',
  searchFields: ['invoice_no', 'customer_name', 'product_name'],
  populate: [COMPANY_POP],
})

// GET /api/retailer/admin/quotations
const listQuotations = companyScopedLister({
  Model: Quotation, key: 'quotations', statusField: 'status',
  searchFields: ['quotation_no', 'customer_name', 'product_name'],
  populate: [COMPANY_POP],
})

// GET /api/retailer/admin/customers
const listCustomers = companyScopedLister({
  Model: Customer, key: 'customers', statusField: null,
  sort: { created_at: -1 },
  searchFields: ['name', 'mobile', 'email', 'gst_number', 'city'],
  populate: [COMPANY_POP],
})

// GET /api/retailer/admin/leads
const listLeads = companyScopedLister({
  Model: Lead, key: 'leads', statusField: 'status',
  searchFields: ['name', 'mobile', 'email', 'source'],
  populate: [COMPANY_POP, { path: 'assigned_to', select: 'name' }],
})

// GET /api/retailer/admin/followups
const listFollowups = companyScopedLister({
  Model: Followup, key: 'followups', statusField: 'status',
  sort: { followup_date: -1, created_at: -1 },
  searchFields: ['notes'],
  populate: [COMPANY_POP, { path: 'assigned_to', select: 'name' }],
})

// GET /api/retailer/admin/inventory — stock on hand per product
// NOTE: Inventory stores only `product_id` / `warehouse_id` — there is NO
// `product_name` or `warehouse_name` on this model (the report controller's
// `r.product_name || '—'` fallback is for legacy rows and effectively always
// falls through). So search is left off here and the CRM filters client-side on
// the populated names, rather than regex-ing fields that don't exist.
const listInventory = companyScopedLister({
  Model: Inventory, key: 'inventory', statusField: null,
  sort: { current_stock: 1 },
  searchFields: [],
  populate: [
    COMPANY_POP,
    { path: 'product_id',   select: 'name code unit category_name brand_name' },
    { path: 'warehouse_id', select: 'name city' },
  ],
})

// GET /api/retailer/admin/dispatches
const listDispatches = companyScopedLister({
  Model: Dispatch, key: 'dispatches', statusField: 'status',
  sort: { dispatch_date: -1, created_at: -1 },
  searchFields: ['dispatch_code', 'customer_name', 'vehicle_number', 'lr_number', 'invoice_number'],
  populate: [COMPANY_POP],
})

/**
 * GET /api/retailer/admin/activity-summary
 *
 * One aggregated payload for the admin Overview tab: how much of each thing the
 * retailer app has produced across every retailer company. Mirrors the shape the
 * wholesaler admin overview reads (flat counts + money), so the CRM page can use
 * the same stat-card renderer.
 */
async function getActivitySummary(req, res) {
  if (!ensureSuperAdmin(req, res)) return
  try {
    const companyIds = await retailerCompanyIds()
    const scope = { company_id: { $in: companyIds } }
    const orderScope = retailerAppDataFilter(companyIds)

    const money = (Model, field = 'total_amount') =>
      Model.aggregate([
        { $match: scope },
        { $group: { _id: null, total: { $sum: `$${field}` }, count: { $sum: 1 } } },
      ])

    const [
      companies, users,
      orders, enquiries,
      salesAgg, purchaseAgg, expenseAgg,
      invoices, quotations, transactions,
      customers, leads, followups,
      inventory, dispatches,
      receivableAgg, payableAgg,
    ] = await Promise.all([
      Company.countDocuments(RETAILER_FILTER),
      User.countDocuments({
        $or: [{ company_id: { $in: companyIds } }, { role: { $in: ['Retailer', 'RetailerStaff'] } }],
      }),
      Order.countDocuments(orderScope),
      Enquiry.countDocuments(orderScope),
      money(Sale),
      money(Purchase),
      money(Expense, 'amount'),
      Invoice.countDocuments(scope),
      Quotation.countDocuments(scope),
      Transaction.countDocuments(scope),
      Customer.countDocuments(scope),
      Lead.countDocuments(scope),
      Followup.countDocuments(scope),
      Inventory.countDocuments(scope),
      Dispatch.countDocuments(scope),
      // Outstanding = anything not fully settled (matches dashboardController).
      Receivable.aggregate([
        { $match: { ...scope, status: { $ne: 'Received' } } },
        { $group: { _id: null, total: { $sum: '$outstanding' } } },
      ]),
      Payable.aggregate([
        { $match: { ...scope, status: { $ne: 'Paid' } } },
        { $group: { _id: null, total: { $sum: '$outstanding' } } },
      ]),
    ])

    const [lowStock, outOfStock] = await Promise.all([
      Inventory.countDocuments({ ...scope, $expr: { $and: [
        { $gt: [{ $max: ['$available_stock', '$current_stock'] }, 0] },
        { $gt: ['$low_stock_alert', 0] },
        { $lte: [{ $max: ['$available_stock', '$current_stock'] }, '$low_stock_alert'] },
      ] } }),
      Inventory.countDocuments({ ...scope, $expr: { $lte: [{ $max: ['$available_stock', '$current_stock'] }, 0] } }),
    ])

    const num = agg => (agg && agg[0]) || { total: 0, count: 0 }

    sendSuccess(res, {
      companies,
      users,
      orders,
      enquiries,
      invoices,
      quotations,
      transactions,
      customers,
      leads,
      followups,
      inventory_items: inventory,
      dispatches,
      sales:        { total: num(salesAgg).total,    count: num(salesAgg).count },
      purchases:    { total: num(purchaseAgg).total, count: num(purchaseAgg).count },
      expenses:     { total: num(expenseAgg).total,  count: num(expenseAgg).count },
      receivable_due: (receivableAgg[0] || {}).total || 0,
      payable_due:    (payableAgg[0]    || {}).total || 0,
      low_stock: lowStock,
      out_of_stock: outOfStock,
    })
  } catch (e) {
    sendError(res, e.message, 500)
  }
}

module.exports = {
  listCompanies, getCompany,
  approveCompany, rejectCompany, suspendCompany, reinstateCompany,
  getCompanyKyc,
  listUsers, listOrders, listEnquiries, listProducts,
  listSales, listPurchases, listExpenses, listTransactions,
  listInvoices, listQuotations, listCustomers, listLeads, listFollowups,
  listInventory, listDispatches,
  getActivitySummary,
}
