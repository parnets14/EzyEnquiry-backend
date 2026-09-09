const bcrypt = require('bcryptjs')
const { sendSuccess, sendError } = require('../../utils/helpers')
const User = require('../../models/User Management/User')
const Company = require('../../models/Company Management/Company')
const Subscription = require('../../models/System Management/Subscription')
const AuditLog = require('../../models/System Management/AuditLog')
const RolePermission = require('../../models/System Management/RolePermission')
const { MODULE_CATALOG, effectivePermissions } = require('../../config/permissions')

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MOBILE_PATTERN = /^\+?[0-9]{7,15}$/
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/
const DOCUMENT_TYPES = [
  { key: 'gst', label: 'GST Certificate', legacyFlag: 'docs_gst', legacyUrl: 'doc_gst_url' },
  { key: 'pan', label: 'PAN Card', legacyFlag: 'docs_pan', legacyUrl: 'doc_pan_url' },
  { key: 'registration', label: 'Business Registration', legacyFlag: 'docs_address', legacyUrl: 'doc_reg_url' },
  { key: 'trade', label: 'Trade License', legacyFlag: 'docs_biz', legacyUrl: 'doc_trade_url' },
]

function cleanText(value) {
  return String(value ?? '').trim()
}

function normalizeMobile(value) {
  return cleanText(value).replace(/[\s()-]/g, '')
}

function permissionSummary(role, permissions) {
  const modules = MODULE_CATALOG.map(module => {
    const actions = module.actions.filter(action => permissions[module.key]?.[action.key] === true)
    return {
      key: module.key,
      label: module.label,
      category: module.category,
      actions: actions.map(action => ({ key: action.key, label: action.label })),
    }
  }).filter(module => module.actions.length > 0)

  return {
    role,
    scope: role === 'Super Admin' ? 'Platform-wide access' : 'Own company access',
    module_count: modules.length,
    action_count: modules.reduce((total, module) => total + module.actions.length, 0),
    total_modules: MODULE_CATALOG.length,
    modules,
  }
}

function companyDocuments(company) {
  return DOCUMENT_TYPES.map(definition => {
    const document = (company.kyc_documents || []).find(item => item.document_type === definition.key)
    const uploaded = Boolean(document?.file_url || company[definition.legacyUrl])
    const status = document?.status || (company[definition.legacyFlag] ? 'Approved' : uploaded ? 'Pending' : 'Not Uploaded')
    return {
      type: definition.key,
      label: definition.label,
      uploaded,
      status,
      reject_reason: document?.reject_reason || '',
      uploaded_at: document?.uploaded_at || null,
      reviewed_at: document?.reviewed_at || null,
    }
  })
}

/** GET /api/profile — complete, current-user account summary. */
async function getProfile(req, res) {
  const userRecord = await User.findById(req.user._id).lean()
  if (!userRecord) return sendError(res, 'User not found.', 404)
  const { password_hash: passwordHash, ...user } = userRecord
  user.has_password = Boolean(passwordHash)

  const [company, permissionDocument, activities] = await Promise.all([
    user.company_id ? Company.findById(user.company_id).lean() : null,
    user.company_id
      ? RolePermission.findOne({ company_id: user.company_id, role: user.role }).lean()
      : null,
    AuditLog.find({ user_id: user._id })
      .sort({ created_at: -1 })
      .limit(20)
      .select('action method module entity_id path status_code ip user_agent created_at')
      .lean(),
  ])

  const subscription = company
    ? await Subscription.findOne({ company_id: company._id, status: 'Active' })
      .sort({ expires_at: -1, created_at: -1 })
      .lean()
    : null

  const permissions = effectivePermissions(user.role, permissionDocument?.permissions)
  const safeCompany = company ? {
    _id: company._id,
    company_code: company.company_code,
    name: company.name,
    owner_name: company.owner_name,
    biz_type: company.biz_type,
    mobile: company.mobile,
    email: company.email,
    gst_number: company.gst_number,
    pan_number: company.pan_number,
    address: company.address,
    city: company.city,
    state: company.state,
    pin_code: company.pin_code,
    subscription_plan: company.subscription_plan,
    status: company.status,
    is_active: company.is_active,
    reject_reason: company.reject_reason,
    approved_at: company.approved_at,
    rejected_at: company.rejected_at,
    documents: companyDocuments(company),
  } : null

  sendSuccess(res, {
    user,
    company: safeCompany,
    subscription,
    access: permissionSummary(user.role, permissions),
    verification: {
      email: { verified: Boolean(user.email_verified_at), verified_at: user.email_verified_at },
      mobile: { verified: Boolean(user.mobile_verified_at), verified_at: user.mobile_verified_at },
      account: { active: Boolean(user.is_active) },
      company: company ? { status: company.status, approved_at: company.approved_at } : null,
    },
    activities,
  })
}

/** PUT /api/profile — self-service identity and contact update. */
async function updateProfile(req, res) {
  const user = await User.findById(req.user._id)
  if (!user) return sendError(res, 'User not found.', 404)

  const name = cleanText(req.body.name)
  const email = cleanText(req.body.email).toLowerCase()
  const mobile = normalizeMobile(req.body.mobile)

  if (!name) return sendError(res, 'Full name is required.', 400)
  if (!email || !EMAIL_PATTERN.test(email)) return sendError(res, 'Enter a valid email address.', 400)
  if (mobile && !MOBILE_PATTERN.test(mobile)) return sendError(res, 'Enter a valid mobile number with 7 to 15 digits.', 400)

  const duplicateConditions = [{ email }]
  if (mobile) duplicateConditions.push({ mobile })
  const duplicate = await User.findOne({
    _id: { $ne: user._id },
    $or: duplicateConditions,
  }).select('email mobile').lean()
  if (duplicate?.email === email) return sendError(res, 'This email address is already in use.', 409)
  if (mobile && duplicate?.mobile === mobile) return sendError(res, 'This mobile number is already in use.', 409)

  if (user.email !== email) user.email_verified_at = null
  if ((user.mobile || '') !== mobile) user.mobile_verified_at = null
  user.name = name
  user.email = email
  user.mobile = mobile
  await user.save()

  const safeUser = user.toObject()
  safeUser.has_password = Boolean(safeUser.password_hash)
  delete safeUser.password_hash
  sendSuccess(res, safeUser, 'Profile updated successfully.')
}

/** PUT /api/profile/company — safely update only the signed-in owner's company. */
async function updateCompany(req, res) {
  if (!req.user.company_id) return sendError(res, 'No company is associated with this account.', 400)
  if (!['Company Owner', 'Super Admin'].includes(req.user.role)) {
    return sendError(res, 'Only the company owner can update company details.', 403)
  }

  const fields = ['name', 'owner_name', 'biz_type', 'mobile', 'email', 'gst_number', 'pan_number', 'address', 'city', 'state', 'pin_code']
  const update = {}
  for (const field of fields) {
    if (req.body[field] !== undefined) update[field] = cleanText(req.body[field])
  }
  if (update.email) update.email = update.email.toLowerCase()
  if (update.mobile) update.mobile = normalizeMobile(update.mobile)

  if (!update.name || !update.owner_name || !update.mobile || !update.email || !update.pan_number) {
    return sendError(res, 'Company name, owner, mobile, email and PAN are required.', 400)
  }
  if (!EMAIL_PATTERN.test(update.email)) return sendError(res, 'Enter a valid company email address.', 400)
  if (!MOBILE_PATTERN.test(update.mobile)) return sendError(res, 'Enter a valid company mobile number.', 400)

  const company = await Company.findOneAndUpdate(
    { _id: req.user.company_id },
    { $set: update },
    { new: true, runValidators: true },
  ).lean()
  if (!company) return sendError(res, 'Company not found.', 404)

  sendSuccess(res, {
    ...company,
    documents: companyDocuments(company),
  }, 'Company details updated successfully.')
}

/** POST /api/profile/change-password */
async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body
  if (!currentPassword || !newPassword) return sendError(res, 'Current and new passwords are required.', 400)
  if (!PASSWORD_PATTERN.test(newPassword)) {
    return sendError(res, 'New password must be at least 8 characters and include uppercase, lowercase, number and special character.', 400)
  }
  if (currentPassword === newPassword) return sendError(res, 'New password must be different from the current password.', 400)

  const user = await User.findById(req.user._id)
  if (!user?.password_hash) return sendError(res, 'Password login is not configured for this account.', 400)
  const valid = await bcrypt.compare(currentPassword, user.password_hash)
  if (!valid) return sendError(res, 'Current password is incorrect.', 400)

  user.password_hash = await bcrypt.hash(newPassword, 12)
  user.password_changed_at = new Date()
  await user.save()
  sendSuccess(res, { password_changed_at: user.password_changed_at }, 'Password changed successfully.')
}

module.exports = { getProfile, updateProfile, updateCompany, changePassword }
