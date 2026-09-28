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

module.exports = {
  listCompanies, getCompany,
  approveCompany, rejectCompany, suspendCompany, reinstateCompany,
  getCompanyKyc,
  listUsers, listOrders, listEnquiries, listProducts,
}
