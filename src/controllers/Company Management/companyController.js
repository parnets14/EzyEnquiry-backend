const { sendSuccess, sendError, paginate } = require('../../utils/helpers')
const path         = require('path')
const fs           = require('fs')
const Company      = require('../../models/Company Management/Company')
const User         = require('../../models/User Management/User')
const Product      = require('../../models/Product Management/Product')
const Notification = require('../../models/System Management/Notification')
const { notifyRetailer } = require('../../utils/pushHelper')
const { getNextCompanyCode } = require('../../utils/sequence')

/** GET /api/companies */
async function listCompanies(req, res) {
  const { status, plan, page = 1, limit = 20 } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)

  const query = {}
  if (status && status !== 'All') query.status            = status
  if (plan   && plan   !== 'All') query.subscription_plan = plan

  const [total, companies] = await Promise.all([
    Company.countDocuments(query),
    Company.find(query)
      .populate('reviewed_by', 'name')
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(parseInt(limit))
      .lean(),
  ])

  // Attach owner user info to each company
  const companyIds = companies.map(c => c._id)
  const owners = await User.find({
    company_id: { $in: companyIds },
    role: 'Company Owner',
  }).select('company_id name mobile email').lean()

  const ownerMap = {}
  owners.forEach(o => { ownerMap[o.company_id.toString()] = o })

  const enriched = companies.map(c => ({
    ...c,
    owner_user: ownerMap[c._id.toString()] || null,
  }))

  sendSuccess(res, { companies: enriched, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

/** GET /api/companies/:id */
async function getCompany(req, res) {
  const company = await Company.findById(req.params.id).lean()
  if (!company) return sendError(res, 'Company not found.', 404)
  sendSuccess(res, company)
}

/** POST /api/companies */
async function createCompany(req, res) {
  const { name, owner_name, biz_type, mobile, email, gst_number, pan_number, address, city, state, pin_code, subscription_plan } = req.body
  if (!name || !owner_name || !mobile || !email || !pan_number)
    return sendError(res, 'Name, owner, mobile, email and PAN are required.')

  const company_code = await getNextCompanyCode()
  const company = await Company.create({
    company_code, name,
    owner_name:        owner_name        || '',
    biz_type:          biz_type          || 'Wholesaler',
    mobile,
    email,
    gst_number:        gst_number        || '',
    pan_number,
    address:           address           || '',
    city:              city              || '',
    state:             state             || '',
    pin_code:          pin_code          || '',
    subscription_plan: subscription_plan || 'Free',
    status:            'Pending',
  })
  sendSuccess(res, company, 'Company registered. Awaiting admin approval.', 201)
}

/** PUT /api/companies/:id */
async function updateCompany(req, res) {
  const { name, owner_name, biz_type, mobile, email, gst_number, pan_number, address, city, state, pin_code, subscription_plan } = req.body
  const update = {}
  if (name              !== undefined) update.name              = name
  if (owner_name        !== undefined) update.owner_name        = owner_name
  if (biz_type          !== undefined) update.biz_type          = biz_type
  if (mobile            !== undefined) update.mobile            = mobile
  if (email             !== undefined) update.email             = email
  if (gst_number        !== undefined) update.gst_number        = gst_number
  if (pan_number        !== undefined) update.pan_number        = pan_number
  if (address           !== undefined) update.address           = address
  if (city              !== undefined) update.city              = city
  if (state             !== undefined) update.state             = state
  if (pin_code          !== undefined) update.pin_code          = pin_code
  if (subscription_plan !== undefined) update.subscription_plan = subscription_plan

  const company = await Company.findByIdAndUpdate(req.params.id, update, { new: true }).lean()
  if (!company) return sendError(res, 'Company not found.', 404)
  sendSuccess(res, company, 'Company updated.')
}

/** PATCH /api/companies/:id/approve */
async function approveCompany(req, res) {
  const company = await Company.findByIdAndUpdate(
    req.params.id,
    { status: 'Approved', reviewed_by: req.user._id },
    { new: true }
  ).lean()
  if (!company) return sendError(res, 'Company not found.', 404)

  company.status = 'Approved'
  company.reject_reason = ''
  company.reviewed_by = req.user._id
  const reviewedAt = new Date()
  for (const document of company.kyc_documents || []) {
    document.status = 'Approved'
    document.reject_reason = ''
    document.reviewed_at = reviewedAt
  }
  await company.save()

  // Ensure all users of this company are active
  await User.updateMany({ company_id: company._id }, { is_active: true })

  // Find the company owner to send notification
  const owner = await User.findOne({ company_id: company._id, role: { $in: ['Company Owner', 'Retailer'] } }).lean()

  if (owner) {
    const ownerName = owner.name || company.owner_name || 'Wholesaler'

    // Create in-app notification for the company owner
    await Notification.create({
      company_id:   company._id,
      user_id:      owner._id,
      type:         'approval',
      title:        'Registration Approved',
      message:      `Congratulations ${ownerName}! Your wholesaler registration has been approved successfully.`,
      reference_id: company._id,
      is_read:      false,
    }).catch(() => {})  // non-fatal

    // Send push notification to retailer
    notifyRetailer(owner._id, {
      title: 'Account Approved!',
      body: `Your company "${company.name}" has been approved. You can now access all features.`,
      type: 'approval',
      referenceId: company._id,
    })
  }

  sendSuccess(res, company, 'Company approved successfully.')
}

/** PATCH /api/companies/:id/reject */
async function rejectCompany(req, res) {
  const { reject_reason } = req.body
  const reason = String(reject_reason || '').trim()
  const company = await Company.findById(req.params.id)
  if (!company) return sendError(res, 'Company not found.', 404)

  company.status = 'Rejected'
  company.reject_reason = reason
  company.reviewed_by = req.user._id
  const reviewedAt = new Date()
  for (const document of company.kyc_documents || []) {
    document.status = 'Rejected'
    document.reject_reason = reason
    document.reviewed_at = reviewedAt
  }
  await company.save()

  // Find owner and notify about rejection
  const owner = await User.findOne({ company_id: company._id, role: { $in: ['Company Owner', 'Retailer'] } }).lean()
  if (owner) {
    await Notification.create({
      company_id:   company._id,
      user_id:      owner._id,
      type:         'rejection',
      title:        '❌ Application Rejected',
      message:      `Your company registration has been rejected. Reason: ${reason || 'Not specified'}. Please contact support for more information.`,
      reference_id: company._id,
      is_read:      false,
    }).catch(() => {})

    // Send push notification to retailer
    notifyRetailer(owner._id, {
      title: 'Application Rejected',
      body: `Your registration was rejected. Reason: ${reason || 'Not specified'}.`,
      type: 'rejection',
      referenceId: company._id,
    })
  }

  sendSuccess(res, company, 'Company rejected.')
}

/** PATCH /api/companies/:id/docs */
async function updateDocs(req, res) {
  const { docs_gst, docs_pan, docs_address, docs_biz } = req.body
  const company = await Company.findById(req.params.id)
  if (!company) return sendError(res, 'Company not found.', 404)

  company.docs_gst = !!docs_gst
  company.docs_pan = !!docs_pan
  company.docs_address = !!docs_address
  company.docs_biz = !!docs_biz

  const approvals = {
    gst: company.docs_gst,
    pan: company.docs_pan,
    registration: company.docs_address,
    trade: company.docs_biz,
  }
  for (const document of company.kyc_documents || []) {
    document.status = approvals[document.document_type] ? 'Approved' : 'Pending'
    document.reject_reason = ''
    document.reviewed_at = approvals[document.document_type] ? new Date() : null
  }

  await company.save()
  sendSuccess(res, company.toObject(), 'Documents updated.')
}

/** DELETE /api/companies/:id */
async function deleteCompany(req, res) {
  const company = await Company.findById(req.params.id).lean()
  if (!company) return sendError(res, 'Company not found.', 404)

  const linkedProductCount = await Product.countDocuments({ company_id: company._id })
  if (linkedProductCount > 0) {
    return sendError(
      res,
      `Cannot delete this company because it owns ${linkedProductCount} product${linkedProductCount === 1 ? '' : 's'}. Delete or reassign those products first.`,
      409
    )
  }

  // Delete all users associated with this company
  await User.deleteMany({ company_id: company._id })
  // Delete the company
  await Company.deleteOne({ _id: company._id })

  sendSuccess(res, null, 'Company and associated users deleted.')
}

/**
 * GET /api/companies/:id/documents/:type
 * Streams a company's KYC document (gst | pan | address | biz) inline.
 * Auth is enforced by the route mount (authenticate). KYC files are not
 * publicly served (see server.js), so this is the sanctioned access path.
 */
const DOC_FIELD_BY_TYPE = {
  gst:     'doc_gst_url',
  pan:     'doc_pan_url',
  address: 'doc_reg_url',   // "Address Proof" maps to registration doc
  biz:     'doc_trade_url', // "Business Registration" maps to trade license
}

const MIME_BY_EXT = {
  '.pdf':  'application/pdf',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
}

async function getCompanyDocument(req, res) {
  const { id, type } = req.params
  const field = DOC_FIELD_BY_TYPE[type]
  if (!field) return sendError(res, 'Invalid document type.', 400)

  const company = await Company.findById(id).select(Object.values(DOC_FIELD_BY_TYPE).join(' ')).lean()
  if (!company) return sendError(res, 'Company not found.', 404)

  const relUrl = company[field]
  if (!relUrl) return sendError(res, 'Document not uploaded.', 404)

  // Resolve to the file on disk. Stored as "/uploads/kyc/<file>".
  // Guard against path traversal by resolving and confirming it stays in /uploads.
  const uploadsRoot = path.resolve(__dirname, '../../../uploads')
  const absPath     = path.resolve(__dirname, '../../..', '.' + relUrl)
  if (!absPath.startsWith(uploadsRoot)) return sendError(res, 'Invalid document path.', 400)
  if (!fs.existsSync(absPath))          return sendError(res, 'File not found on server.', 404)

  const ext  = path.extname(absPath).toLowerCase()
  const mime = MIME_BY_EXT[ext] || 'application/octet-stream'
  res.setHeader('Content-Type', mime)
  res.setHeader('Content-Disposition', `inline; filename="${type}${ext}"`)
  fs.createReadStream(absPath).pipe(res)
}

module.exports = { listCompanies, getCompany, createCompany, updateCompany, approveCompany, rejectCompany, updateDocs, deleteCompany, getCompanyDocument }
