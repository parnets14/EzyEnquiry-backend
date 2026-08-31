const bcrypt  = require('bcryptjs')
const jwt     = require('jsonwebtoken')
const User    = require('../models/User Management/User')
const Company = require('../models/Company Management/Company')
const { generateOtp, storeOtp, verifyOtp } = require('../utils/otp')
const { sendOtpMail }            = require('../utils/mailer')
const { sendSuccess, sendError } = require('../utils/helpers')
const { getNextCompanyCode }     = require('../utils/sequence')

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  })
}

/** POST /api/auth/login */
async function login(req, res) {
  const { email, password } = req.body
  if (!email || !password) return sendError(res, 'Email and password are required.')

  const user = await User.findOne({ email: email.toLowerCase().trim() }).lean()
  if (!user)           return sendError(res, 'Invalid email or password.', 401)
  if (!user.is_active) return sendError(res, 'Account is deactivated. Contact admin.', 403)

  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) return sendError(res, 'Invalid email or password.', 401)

  await User.findByIdAndUpdate(user._id, { last_login: new Date() })

  const token = signToken(user._id)
  const { password_hash, ...userSafe } = user
  sendSuccess(res, { token, user: userSafe }, 'Login successful')
}

/** POST /api/auth/send-otp */
async function sendOtp(req, res) {
  // Mobile app sends { mobile }, web may send { target, type }
  const rawTarget = req.body.mobile || req.body.target
  const target    = rawTarget ? String(rawTarget).trim() : rawTarget
  const type      = req.body.mobile ? 'mobile' : (req.body.type || 'email')
  const purpose   = req.body.purpose || 'login'
  if (!target) return sendError(res, 'Mobile number or email is required.')

  console.log(`[Send OTP] target="${target}" purpose="${purpose}" type="${type}"`)

  const otp = generateOtp()
  await storeOtp(target, otp, purpose, type)

  // Send via email if target looks like an email
  if (type === 'email' || target.includes('@')) {
    await sendOtpMail(target, otp, purpose).catch(() => {})
  }

  // Always log OTP to console (visible in server terminal)
  console.log(`\n========================================`)
  console.log(`  OTP for ${target}: ${otp}  [${purpose}]`)
  console.log(`========================================\n`)

  // In dev mode, return OTP in response so mobile app can display it during testing
  const devReturn = process.env.OTP_DEV_RETURN === 'true' && process.env.NODE_ENV !== 'production'
  const responseData = { sent: true }
  if (devReturn) responseData.otp = otp

  sendSuccess(res, responseData, `OTP sent to ${type === 'email' ? 'email' : 'mobile'}`)
}

/** POST /api/auth/verify-otp */
async function verifyOtpHandler(req, res) {
  // Mobile app sends { mobile, otp }, web may send { target, otp }
  const rawTarget = req.body.mobile || req.body.target
  const target    = rawTarget ? String(rawTarget).trim() : rawTarget
  const { purpose = 'login' } = req.body
  const otpVal    = String(req.body.otp || '').trim()

  if (!target || !otpVal) return sendError(res, 'Mobile/email and OTP are required.')

  console.log(`[OTP Verify] target="${target}" otp="${otpVal}" purpose="${purpose}"`)

  const result = await verifyOtp(target, otpVal, purpose)
  if (!result.valid) {
    console.log(`[OTP Verify] FAILED: ${result.reason}`)
    return sendError(res, result.reason, 400)
  }

  if (purpose === 'login') {
    // Normalise lookup: trim + case-insensitive email match
    const user = await User.findOne({
      $or: [
        { email:  target.toLowerCase() },
        { mobile: target },
      ],
    })
      .select('-password_hash')
      .lean()
    if (!user)           return sendError(res, 'User not found.', 404)
    if (!user.is_active) return sendError(res, 'Account deactivated.', 403)

    await User.findByIdAndUpdate(user._id, { last_login: new Date() })
    const token = signToken(user._id)

    // Build enriched user response with company status (for mobile app)
    let company = null
    if (user.company_id) {
      company = await Company.findById(user.company_id)
        .select('name status subscription_plan docs_gst docs_pan docs_address docs_biz')
        .lean()
    }
    const enrichedUser = {
      ...user,
      company_name:      company?.name              || null,
      company_status:    company?.status            || null,
      subscription_plan: company?.subscription_plan || null,
      is_approved:       company?.status === 'Approved',
    }

    console.log(`[OTP Verify] SUCCESS — user=${user._id}`)
    return sendSuccess(res, { token, user: enrichedUser }, 'OTP verified. Login successful.')
  }

  sendSuccess(res, { verified: true }, 'OTP verified successfully.')
}

/** GET /api/auth/me */
async function me(req, res) {
  const user = await User.findById(req.user._id).select('-password_hash').lean()
  if (!user) return sendError(res, 'User not found.', 404)

  let company = null
  if (user.company_id) {
    company = await Company.findById(user.company_id).select('name subscription_plan status').lean()
  }

  sendSuccess(res, {
    ...user,
    company_name:      company?.name              || null,
    subscription_plan: company?.subscription_plan || null,
    company_status:    company?.status            || null,
  })
}

/** POST /api/auth/change-password */
async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body
  if (!currentPassword || !newPassword) return sendError(res, 'Both fields are required.')
  if (newPassword.length < 8) return sendError(res, 'New password must be at least 8 characters.')

  const user = await User.findById(req.user._id).lean()
  const valid = await bcrypt.compare(currentPassword, user.password_hash)
  if (!valid) return sendError(res, 'Current password is incorrect.', 400)

  const password_hash = await bcrypt.hash(newPassword, 12)
  await User.findByIdAndUpdate(req.user._id, { password_hash })
  sendSuccess(res, null, 'Password changed successfully.')
}

/** POST /api/auth/logout */
async function logout(req, res) {
  sendSuccess(res, null, 'Logged out successfully.')
}

/**
 * POST /api/auth/register
 * Step 1 of onboarding — creates Company + Company Owner user.
 * Company status = 'Pending' until admin approves.
 * Body: { companyName, ownerName, mobile, email, gstNumber, panNumber,
 *         businessType, address, city, state, pincode }
 */
async function register(req, res) {
  const {
    companyName, ownerName, mobile, email,
    gstNumber, panNumber, businessType,
    address, city, state, pincode,
  } = req.body

  // Basic validation
  const required = { companyName, ownerName, mobile, email, businessType }
  for (const [field, val] of Object.entries(required)) {
    if (!val || String(val).trim() === '') {
      return sendError(res, `${field} is required.`, 400)
    }
  }
  if (!/^\d{10}$/.test(mobile)) return sendError(res, 'Mobile must be 10 digits.', 400)

  // Duplicate checks
  const existingEmail  = await User.findOne({ email: email.toLowerCase().trim() }).lean()
  if (existingEmail)  return sendError(res, 'Email already registered.', 409)

  const existingMobile = await User.findOne({ mobile }).lean()
  if (existingMobile) return sendError(res, 'Mobile number already registered.', 409)

  // Generate sequential company code (EZY001, EZY002, ...)
  const companyCode = await getNextCompanyCode()

  // Create Company
  const company = await Company.create({
    company_code: companyCode,
    name:        companyName.trim(),
    owner_name:  ownerName.trim(),
    biz_type:    businessType.trim(),
    mobile,
    email:       email.toLowerCase().trim(),
    gst_number:  gstNumber  || '',
    pan_number:  panNumber  || '',
    address:     address    || '',
    city:        city       || '',
    state:       state      || '',
    pin_code:    pincode    || '',
    status:      'Pending',
  })

  // Create Company Owner user (no password — OTP-only login)
  const user = await User.create({
    company_id: company._id,
    name:       ownerName.trim(),
    email:      email.toLowerCase().trim(),
    mobile,
    role:       'Company Owner',
    is_active:  true,
  })

  sendSuccess(
    res,
    { userId: user._id, companyId: company._id, companyCode },
    'Registration successful. Please upload your documents.',
    201
  )
}

/**
 * POST /api/auth/upload-docs
 * Step 2 of onboarding — upload KYC documents.
 * Multipart form: fields gst, pan, trade (files)
 * Header: X-Company-Mobile or body.mobile to identify the company
 */
async function uploadDocs(req, res) {
  const { mobile } = req.body
  if (!mobile) return sendError(res, 'Mobile is required to identify the company.', 400)

  const user = await User.findOne({ mobile }).lean()
  if (!user) return sendError(res, 'No registration found for this mobile.', 404)

  const company = await Company.findById(user.company_id)
  if (!company) return sendError(res, 'Company not found.', 404)

  const fileMap = req.files || {}   // multer .fields() gives { gst:[...], pan:[...], ... }
  const updates = {}

  if (fileMap.gst && fileMap.gst[0]) {
    updates.doc_gst_url = `/uploads/kyc/${fileMap.gst[0].filename}`
    updates.docs_gst    = true
  }
  if (fileMap.pan && fileMap.pan[0]) {
    updates.doc_pan_url = `/uploads/kyc/${fileMap.pan[0].filename}`
    updates.docs_pan    = true
  }
  if (fileMap.trade && fileMap.trade[0]) {
    updates.doc_trade_url = `/uploads/kyc/${fileMap.trade[0].filename}`
    updates.docs_biz      = true
  }
  if (fileMap.reg && fileMap.reg[0]) {
    updates.doc_reg_url   = `/uploads/kyc/${fileMap.reg[0].filename}`
    updates.docs_address  = true
  }

  if (Object.keys(updates).length === 0) {
    return sendError(res, 'No documents received.', 400)
  }

  await Company.findByIdAndUpdate(company._id, updates)
  sendSuccess(res, { uploaded: Object.keys(updates).length }, 'Documents uploaded. Awaiting admin approval.')
}

/**
 * POST /api/auth/check-mobile
 * Public endpoint used by WelcomeScreen to decide:
 *   exists: true  → user already registered → redirect to Login
 *   exists: false → new user                → redirect to Registration
 */
async function checkMobile(req, res) {
  const { mobile } = req.body
  if (!mobile || !/^\d{10}$/.test(mobile)) {
    return sendError(res, 'Please provide a valid 10-digit mobile number.', 400)
  }
  const user = await User.findOne({ mobile }).select('_id').lean()
  sendSuccess(res, { exists: !!user })
}

module.exports = { login, sendOtp, verifyOtpHandler, me, changePassword, logout, register, uploadDocs, checkMobile }
