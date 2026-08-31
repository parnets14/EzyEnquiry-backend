const bcrypt = require('bcryptjs')
const fs = require('fs')
const path = require('path')

const User = require('../../models/User Management/User')
const Company = require('../../models/Company Management/Company')
const Subscription = require('../../models/System Management/Subscription')
const Enquiry = require('../../models/Marketplace Management/Enquiry')
const Order = require('../../models/Marketplace Management/Order')
const { KYC_DIR } = require('../../middleware/retailerKycUpload')
const authController = require('./retailerAuthController')
const { sendSuccess, sendError } = require('../../utils/helpers')

const PLAN_CATALOGUE = Object.freeze([
  {
    id: 'Free', name: 'Free', price_inr: 0, billing_period: 'month',
    limits: { enquiries_per_month: 25, orders_per_month: 10 },
    features: ['Retailer catalogue', 'Enquiries', 'Order tracking'],
  },
  {
    id: 'Retailer Basic', name: 'Retailer Basic', price_inr: 499, billing_period: 'month',
    limits: { enquiries_per_month: 250, orders_per_month: 100 },
    features: ['Retailer catalogue', 'Enquiries', 'Order tracking', 'Priority support'],
  },
  {
    id: 'Retailer Pro', name: 'Retailer Pro', price_inr: 1499, billing_period: 'month',
    limits: { enquiries_per_month: null, orders_per_month: null },
    features: ['Unlimited enquiries', 'Unlimited orders', 'Order tracking', 'Priority support'],
  },
])

function cleanString(value, max = 500) {
  return String(value || '').trim().slice(0, max)
}

function publicProfile(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    mobile: user.mobile || '',
    role: user.role,
    is_active: !!user.is_active,
    has_password: !!user.password_hash,
    last_login: user.last_login,
  }
}

function publicCompany(company) {
  return {
    id: company._id,
    company_code: company.company_code || '',
    name: company.name || '',
    owner_name: company.owner_name || '',
    biz_type: company.biz_type,
    mobile: company.mobile || '',
    email: company.email || '',
    gst_number: company.gst_number || '',
    pan_number: company.pan_number || '',
    address: company.address || '',
    city: company.city || '',
    state: company.state || '',
    pin_code: company.pin_code || '',
    addresses: company.addresses || [],
    status: company.status,
    is_active: company.is_active !== false,
    reject_reason: company.status === 'Rejected' ? company.reject_reason || '' : '',
    subscription_plan: company.subscription_plan || 'Free',
  }
}

async function getProfile(req, res) {
  const user = await User.findById(req.user._id).select('-password_hash').lean()
  if (!user) return sendError(res, 'User not found.', 404)
  return sendSuccess(res, { profile: publicProfile(user), company: publicCompany(req.company) })
}

async function updateProfile(req, res) {
  const user = await User.findById(req.user._id)
  if (!user) return sendError(res, 'User not found.', 404)

  if (req.body.name !== undefined) {
    const name = cleanString(req.body.name, 150)
    if (!name) return sendError(res, 'name cannot be empty.', 400)
    user.name = name
  }
  if (req.body.mobile !== undefined) {
    const mobile = cleanString(req.body.mobile, 10)
    if (!/^\d{10}$/.test(mobile)) return sendError(res, 'mobile must be exactly 10 digits.', 400)
    const exists = await User.exists({ mobile, _id: { $ne: user._id } })
    if (exists) return sendError(res, 'This mobile number is already registered.', 409)
    user.mobile = mobile
  }
  if (req.body.email !== undefined) {
    const email = cleanString(req.body.email, 254).toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendError(res, 'A valid email is required.', 400)
    const exists = await User.exists({ email, _id: { $ne: user._id } })
    if (exists) return sendError(res, 'This email address is already registered.', 409)
    user.email = email
  }
  await user.save()
  return sendSuccess(res, publicProfile(user.toObject()), 'Profile updated.')
}

async function getCompany(req, res) {
  return sendSuccess(res, publicCompany(req.company))
}

async function updateCompany(req, res) {
  const company = await Company.findById(req.user.company_id)
  if (!company) return sendError(res, 'Company not found.', 404)

  const stringFields = {
    name: 200, owner_name: 150, mobile: 10, email: 254,
    gst_number: 30, pan_number: 20, address: 500, city: 100, state: 100, pin_code: 10,
  }
  for (const [field, max] of Object.entries(stringFields)) {
    if (req.body[field] !== undefined) company[field] = cleanString(req.body[field], max)
  }
  if (!company.name) return sendError(res, 'Company name cannot be empty.', 400)
  if (company.mobile && !/^\d{10}$/.test(company.mobile)) return sendError(res, 'Company mobile must be exactly 10 digits.', 400)
  if (company.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(company.email)) return sendError(res, 'Company email is invalid.', 400)
  if (company.pin_code && !/^\d{6}$/.test(company.pin_code)) return sendError(res, 'pin_code must be exactly 6 digits.', 400)

  await company.save()
  return sendSuccess(res, publicCompany(company.toObject()), 'Company updated.')
}

async function listAddresses(req, res) {
  return sendSuccess(res, { addresses: req.company.addresses || [] })
}

function validateAddress(body) {
  const address = {
    label: cleanString(body.label || 'Delivery', 50),
    contact_name: cleanString(body.contact_name, 150),
    mobile: cleanString(body.mobile, 10),
    address: cleanString(body.address, 500),
    city: cleanString(body.city, 100),
    state: cleanString(body.state, 100),
    pin_code: cleanString(body.pin_code || body.pincode, 6),
    is_default: body.is_default === true,
  }
  if (!address.address || !address.city || !address.state || !/^\d{6}$/.test(address.pin_code)) {
    return { error: 'address, city, state, and a 6-digit pin_code are required.' }
  }
  if (address.mobile && !/^\d{10}$/.test(address.mobile)) return { error: 'Address mobile must be exactly 10 digits.' }
  return { address }
}

async function addAddress(req, res) {
  const validation = validateAddress(req.body)
  if (validation.error) return sendError(res, validation.error, 400)
  const company = await Company.findById(req.user.company_id)
  if (company.addresses.length >= 20) return sendError(res, 'A maximum of 20 addresses is allowed.', 409)
  if (!company.addresses.length) validation.address.is_default = true
  if (validation.address.is_default) company.addresses.forEach(item => { item.is_default = false })
  company.addresses.push(validation.address)
  await company.save()
  return sendSuccess(res, company.addresses[company.addresses.length - 1], 'Address added.', 201)
}

async function updateAddress(req, res) {
  const validation = validateAddress(req.body)
  if (validation.error) return sendError(res, validation.error, 400)
  const company = await Company.findById(req.user.company_id)
  const address = company.addresses.id(req.params.id)
  if (!address) return sendError(res, 'Address not found.', 404)
  if (validation.address.is_default) company.addresses.forEach(item => { item.is_default = false })
  Object.assign(address, validation.address)
  await company.save()
  return sendSuccess(res, address, 'Address updated.')
}

async function deleteAddress(req, res) {
  const company = await Company.findById(req.user.company_id)
  const address = company.addresses.id(req.params.id)
  if (!address) return sendError(res, 'Address not found.', 404)
  const wasDefault = address.is_default
  address.deleteOne()
  if (wasDefault && company.addresses.length) company.addresses[0].is_default = true
  await company.save()
  return sendSuccess(res, null, 'Address deleted.')
}

async function changePassword(req, res) {
  const currentPassword = String(req.body.current_password || '')
  const newPassword = String(req.body.new_password || '')
  if (newPassword.length < 6) return sendError(res, 'new_password must be at least 6 characters.', 400)

  const user = await User.findById(req.user._id)
  if (!user) return sendError(res, 'User not found.', 404)
  if (user.password_hash) {
    if (!currentPassword) return sendError(res, 'current_password is required.', 400)
    const valid = await bcrypt.compare(currentPassword, user.password_hash)
    if (!valid) return sendError(res, 'Current password is incorrect.', 401)
  }
  user.password_hash = await bcrypt.hash(newPassword, 12)
  await user.save()
  return sendSuccess(res, { had_password: !!currentPassword }, 'Password updated.')
}

async function getKycDocuments(req, res) {
  const company = await Company.findById(req.user.company_id).lean()
  if (!company) return sendError(res, 'Company not found.', 404)
  return sendSuccess(res, {
    company_status: company.status,
    documents: authController.safeKycDocuments(company),
  })
}

async function downloadKycDocument(req, res) {
  const documentType = String(req.params.type)
  if (!['gst', 'pan', 'trade', 'registration'].includes(documentType)) return sendError(res, 'Document not found.', 404)
  const company = await Company.findById(req.user.company_id).select('kyc_documents').lean()
  const document = company?.kyc_documents?.find(item => item.document_type === documentType)
  if (!document?.file_url) return sendError(res, 'Document not found.', 404)

  const filename = path.basename(document.file_url)
  const absolutePath = path.resolve(KYC_DIR, filename)
  const root = `${path.resolve(KYC_DIR)}${path.sep}`
  if (!absolutePath.startsWith(root) || !fs.existsSync(absolutePath)) return sendError(res, 'Document file not found.', 404)
  return res.sendFile(absolutePath)
}

async function getPlans(_req, res) {
  return sendSuccess(res, { plans: PLAN_CATALOGUE, purchase_available: false }, 'Plan catalogue retrieved.')
}

async function getCurrentSubscription(req, res) {
  const now = new Date()
  const [subscription, enquiryUsage, orderUsage] = await Promise.all([
    Subscription.findOne({ company_id: req.user.company_id, status: 'Active', starts_at: { $lte: now }, expires_at: { $gt: now } }).sort({ created_at: -1 }).lean(),
    Enquiry.countDocuments({ buyer_company_id: req.user.company_id, created_at: { $gte: new Date(now.getFullYear(), now.getMonth(), 1) } }),
    Order.countDocuments({ buyer_company_id: req.user.company_id, created_at: { $gte: new Date(now.getFullYear(), now.getMonth(), 1) } }),
  ])
  const plan = PLAN_CATALOGUE.find(item => item.id === req.company.subscription_plan) || PLAN_CATALOGUE[0]
  return sendSuccess(res, {
    plan,
    subscription: subscription ? {
      id: subscription._id,
      starts_at: subscription.starts_at,
      expires_at: subscription.expires_at,
      status: subscription.status,
    } : null,
    usage: {
      period: 'current_month',
      enquiries: { used: enquiryUsage, limit: plan.limits.enquiries_per_month },
      orders: { used: orderUsage, limit: plan.limits.orders_per_month },
    },
    purchase_available: false,
  }, 'Subscription retrieved.')
}

async function getCapabilities(_req, res) {
  return sendSuccess(res, {
    platform: 'android',
    capabilities: authController.capabilities(),
    notes: {
      order_tracking: 'Status and dispatch metadata are available; live GPS is not configured.',
      payments: 'Plan purchase and arbitrary payment submission are disabled.',
    },
  })
}

module.exports = {
  PLAN_CATALOGUE,
  getProfile,
  updateProfile,
  getCompany,
  updateCompany,
  listAddresses,
  addAddress,
  updateAddress,
  deleteAddress,
  changePassword,
  getKycDocuments,
  downloadKycDocument,
  getPlans,
  getCurrentSubscription,
  getCapabilities,
}
