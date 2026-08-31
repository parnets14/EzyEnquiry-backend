const { sendSuccess, sendError, paginate } = require('../../utils/helpers')
const Company          = require('../../models/Company Management/Company')
const User             = require('../../models/User Management/User')
const Notification     = require('../../models/System Management/Notification')
const { sendPushToUser } = require('../../utils/fcm')

// ── Helper: generate next company code ───────────────────────
async function getNextCompanyCode() {
  const last = await Company.findOne({ company_code: /^COM-/ }).sort({ company_code: -1 }).lean()
  if (!last?.company_code) return 'COM-001'
  const num = parseInt(last.company_code.replace('COM-', ''), 10)
  return `COM-${String(num + 1).padStart(3, '0')}`
}

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
  // Fetch current state first to prevent duplicate approvals
  const existing = await Company.findById(req.params.id).lean()
  if (!existing) return sendError(res, 'Company not found.', 404)

  if (existing.status === 'Approved') {
    return sendError(res, 'This company is already approved. No action taken.', 409)
  }

  const now     = new Date()
  const company = await Company.findByIdAndUpdate(
    req.params.id,
    {
      status:      'Approved',
      reviewed_by: req.user._id,
      approved_at: now,
      approved_by: req.user._id,
    },
    { new: true }
  ).lean()
  if (!company) return sendError(res, 'Company not found.', 404)

  // Ensure all users of this company are active
  await User.updateMany({ company_id: company._id }, { is_active: true })

  // Find the company owner to send notification
  const owner = await User.findOne({ company_id: company._id, role: 'Company Owner' }).lean()

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

    // Send FCM push notification to wholesaler's device(s)
    // data payload values must all be strings for FCM
    await sendPushToUser(
      owner._id,
      'Registration Approved',
      `Congratulations ${ownerName}! Your wholesaler registration has been approved successfully.`,
      {
        type:       'approval',
        company_id: String(company._id),
        user_id:    String(owner._id),
        status:     'Approved',
        ownerName:  ownerName,
      }
    ).catch(() => {})  // non-fatal — never block the HTTP response
  }

  sendSuccess(res, company, 'Company approved successfully.')
}

/** PATCH /api/companies/:id/reject */
async function rejectCompany(req, res) {
  const { reject_reason } = req.body
  const company = await Company.findByIdAndUpdate(
    req.params.id,
    { status: 'Rejected', reject_reason: reject_reason || '', reviewed_by: req.user._id },
    { new: true }
  ).lean()
  if (!company) return sendError(res, 'Company not found.', 404)

  // Find owner and notify about rejection
  const owner = await User.findOne({ company_id: company._id, role: 'Company Owner' }).lean()
  if (owner) {
    await Notification.create({
      company_id:   company._id,
      user_id:      owner._id,
      type:         'rejection',
      title:        '❌ Application Rejected',
      message:      `Your company registration has been rejected. Reason: ${reject_reason || 'Not specified'}. Please contact support for more information.`,
      reference_id: company._id,
      is_read:      false,
    }).catch(() => {})

    // Send FCM push notification for rejection
    await sendPushToUser(
      owner._id,
      '❌ Application Rejected',
      `Your company registration was rejected. Reason: ${reject_reason || 'Not specified'}. Contact support for help.`,
      {
        type:       'rejection',
        company_id: String(company._id),
        status:     'Rejected',
      }
    ).catch(() => {})  // non-fatal
  }

  sendSuccess(res, company, 'Company rejected.')
}

/** PATCH /api/companies/:id/docs */
async function updateDocs(req, res) {
  const { docs_gst, docs_pan, docs_address, docs_biz } = req.body
  const company = await Company.findByIdAndUpdate(
    req.params.id,
    { docs_gst: !!docs_gst, docs_pan: !!docs_pan, docs_address: !!docs_address, docs_biz: !!docs_biz },
    { new: true }
  ).lean()
  if (!company) return sendError(res, 'Company not found.', 404)
  sendSuccess(res, company, 'Documents updated.')
}

/** DELETE /api/companies/:id */
async function deleteCompany(req, res) {
  const result = await Company.deleteOne({ _id: req.params.id })
  if (result.deletedCount === 0) return sendError(res, 'Company not found.', 404)
  sendSuccess(res, null, 'Company deleted.')
}

module.exports = { listCompanies, getCompany, createCompany, updateCompany, approveCompany, rejectCompany, updateDocs, deleteCompany }
