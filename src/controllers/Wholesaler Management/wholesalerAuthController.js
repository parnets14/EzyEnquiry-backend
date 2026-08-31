/**
 * Wholesaler App — Auth Controller
 * All endpoints under /api/wholesaler/auth/
 *
 * Endpoints:
 *  POST /check-mobile      — check if mobile registered
 *  POST /send-otp          — send OTP to mobile
 *  POST /verify-otp        — verify OTP → return JWT + user
 *  POST /register          — register company + owner (step 1)
 *  POST /upload-docs       — upload KYC docs (step 2)
 *  GET  /me                — get logged-in user profile
 *  POST /fcm-token         — save FCM push token
 *  POST /logout            — invalidate FCM token / logout
 */

const bcrypt  = require('bcryptjs')
const jwt     = require('jsonwebtoken')
const path    = require('path')
const fs      = require('fs')

const User               = require('../../models/User Management/User')
const Company            = require('../../models/Company Management/Company')
const WholesalerSession  = require('../../models/Wholesaler Management/WholesalerSession')
const { generateOtp, storeOtp, verifyOtp } = require('../../utils/otp')
const { sendOtpMail }                      = require('../../utils/mailer')
const { sendSuccess, sendError }           = require('../../utils/helpers')
const { getNextCompanyCode }               = require('../../utils/sequence')

// ── Helpers ──────────────────────────────────────────────────────────────────

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  })
}

/** Build safe user object (no password_hash) + company status fields */
async function buildUserResponse(user) {
  const company = user.company_id
    ? await Company.findById(user.company_id)
        .select('name status subscription_plan docs_gst docs_pan docs_address docs_biz')
        .lean()
    : null

  const { password_hash, ...safe } = user  // remove hash if present

  return {
    ...safe,
    company_name:      company?.name              || null,
    company_status:    company?.status            || null,  // 'Pending' | 'Approved' | 'Rejected'
    subscription_plan: company?.subscription_plan || null,
    docs_submitted: {
      gst:     company?.docs_gst     || false,
      pan:     company?.docs_pan     || false,
      address: company?.docs_address || false,
      biz:     company?.docs_biz     || false,
    },
    is_approved: company?.status === 'Approved',
  }
}

// ── Controllers ──────────────────────────────────────────────────────────────

/**
 * POST /api/wholesaler/auth/check-mobile
 * Body: { mobile }
 * Returns: { exists: boolean }
 * Used by WelcomeScreen to route → Login or Registration
 */
async function checkMobile(req, res) {
  const mobile = String(req.body.mobile || '').trim()
  if (!mobile || !/^\d{10}$/.test(mobile)) {
    return sendError(res, 'Please provide a valid 10-digit mobile number.', 400)
  }
  const user = await User.findOne({ mobile }).select('_id').lean()
  sendSuccess(res, { exists: !!user })
}

/**
 * POST /api/wholesaler/auth/send-otp
 * Body: { mobile, purpose? }  — purpose defaults to 'login'
 * Returns: { sent: true, otp? }  — otp only returned in dev mode
 *
 * For purpose='login': validates that mobile is registered first.
 * For purpose='register': no user check needed.
 */
async function sendOtpHandler(req, res) {
  const mobile  = String(req.body.mobile || '').trim()
  const purpose = req.body.purpose || 'login'

  if (!mobile || !/^\d{10}$/.test(mobile)) {
    return sendError(res, 'Please provide a valid 10-digit mobile number.', 400)
  }

  // For login OTP — verify user exists before sending OTP
  if (purpose === 'login') {
    const exists = await User.findOne({ mobile }).select('_id is_active').lean()
    if (!exists) {
      return sendError(
        res,
        'This mobile number is not registered. Please create an account first.',
        404
      )
    }
    if (!exists.is_active) {
      return sendError(res, 'This account is deactivated. Contact support.', 403)
    }
  }

  const otp = generateOtp()
  await storeOtp(mobile, otp, purpose, 'mobile')

  // Log to server terminal always
  console.log(`\n${'='.repeat(44)}`)
  console.log(`  [App OTP] ${mobile} → ${otp}  [${purpose}]`)
  console.log(`${'='.repeat(44)}\n`)

  // Dev mode: return OTP in response for easy testing
  const isDev    = process.env.NODE_ENV !== 'production'
  const devReturn = process.env.OTP_DEV_RETURN === 'true' && isDev
  const data     = { sent: true }
  if (devReturn) data.otp = otp

  sendSuccess(res, data, 'OTP sent to mobile')
}

/**
 * POST /api/wholesaler/auth/verify-otp
 * Body: { mobile, otp, purpose? }
 * Returns: { token, user } on success
 *
 * NOTE: OTP may have been sent via either:
 *   /api/auth/send-otp  (old route — still used by some cached app builds)
 *   /api/wholesaler/auth/send-otp  (new route)
 * Both use the same otp.js utility and same OtpStore collection,
 * so verification works regardless of which send endpoint was used.
 */
async function verifyOtpHandler(req, res) {
  const mobile  = String(req.body.mobile || '').trim()
  const otpVal  = String(req.body.otp    || '').trim()
  const purpose = req.body.purpose || 'login'

  if (!mobile || !otpVal) {
    return sendError(res, 'Mobile number and OTP are required.', 400)
  }
  if (!/^\d{10}$/.test(mobile)) {
    return sendError(res, 'Invalid mobile number.', 400)
  }

  console.log(`[WS OTP Verify] mobile="${mobile}" otp="${otpVal}" purpose="${purpose}"`)

  // Verify OTP — checks OtpStore for any valid record matching mobile+purpose
  const result = await verifyOtp(mobile, otpVal, purpose)
  if (!result.valid) {
    console.log(`[WS OTP Verify] FAILED: ${result.reason}`)
    return sendError(res, result.reason || 'Invalid or expired OTP.', 400)
  }

  // For login — find user and return token
  if (purpose === 'login') {
    const userDoc = await User.findOne({ mobile })
      .select('-password_hash')
      .lean()

    if (!userDoc) {
      // User not found — give clear guidance
      return sendError(
        res,
        'No account found for this mobile number. Please register first.',
        404
      )
    }
    if (!userDoc.is_active) {
      return sendError(res, 'Your account has been deactivated. Contact support.', 403)
    }

    // Update last_login
    await User.findByIdAndUpdate(userDoc._id, { last_login: new Date() })

    const token = signToken(userDoc._id)
    const user  = await buildUserResponse(userDoc)

    console.log(`[WS OTP Verify] SUCCESS — user=${userDoc._id}`)
    return sendSuccess(res, { token, user }, 'OTP verified. Login successful.')
  }

  // For register OTP verification — just confirm verified
  sendSuccess(res, { verified: true, mobile }, 'OTP verified.')
}

/**
 * POST /api/wholesaler/auth/login
 * Password-based sign-in for the app.
 * Body: { identifier, password }  — identifier is a 10-digit mobile OR email.
 * Returns { token, user } on success.
 */
async function loginPassword(req, res) {
  const identifier = String(req.body.identifier || req.body.mobile || req.body.email || '').trim()
  const password   = String(req.body.password || '')

  if (!identifier || !password) {
    return sendError(res, 'Mobile/email and password are required.', 400)
  }

  // Look up by mobile if all digits, otherwise by email
  const isMobile = /^\d{10}$/.test(identifier)
  const query = isMobile
    ? { mobile: identifier }
    : { email: identifier.toLowerCase() }

  const userDoc = await User.findOne(query).lean()

  if (!userDoc) {
    return sendError(res, 'No account found. Please check your details or register first.', 404)
  }
  if (!userDoc.is_active) {
    return sendError(res, 'Your account has been deactivated. Contact support.', 403)
  }
  if (!userDoc.password_hash) {
    return sendError(res, 'This account has no password set. Please use OTP login.', 400)
  }

  const valid = await bcrypt.compare(password, userDoc.password_hash)
  if (!valid) {
    return sendError(res, 'Invalid mobile/email or password.', 401)
  }

  await User.findByIdAndUpdate(userDoc._id, { last_login: new Date() })

  const token = signToken(userDoc._id)
  const user  = await buildUserResponse(userDoc)

  return sendSuccess(res, { token, user }, 'Login successful.')
}

/**
 * POST /api/wholesaler/auth/register
 * Step 1 — Create Company + Company Owner
 * Body: { companyName, ownerName, mobile, email, businessType,
 *         gstNumber?, panNumber?, address?, city?, state?, pincode? }
 */
async function register(req, res) {
  const {
    companyName, ownerName, mobile, email, businessType, password,
    gstNumber, panNumber, address, city, state, pincode,
  } = req.body

  // Required field validation
  const required = { companyName, ownerName, mobile, email, businessType, password }
  for (const [field, val] of Object.entries(required)) {
    if (!val || String(val).trim() === '') {
      return sendError(res, `${field} is required.`, 400)
    }
  }

  const cleanMobile = String(mobile).trim()
  const cleanEmail  = String(email).toLowerCase().trim()

  if (!/^\d{10}$/.test(cleanMobile)) {
    return sendError(res, 'Mobile must be exactly 10 digits.', 400)
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return sendError(res, 'Please provide a valid email address.', 400)
  }
  if (String(password).length < 6) {
    return sendError(res, 'Password must be at least 6 characters.', 400)
  }

  // Duplicate checks
  const [existingMobile, existingEmail] = await Promise.all([
    User.findOne({ mobile: cleanMobile }).lean(),
    User.findOne({ email: cleanEmail }).lean(),
  ])
  if (existingMobile) return sendError(res, 'This mobile number is already registered.', 409)
  if (existingEmail)  return sendError(res, 'This email address is already registered.', 409)

  // Generate sequential company code (EZY001, EZY002, ...)
  const companyCode = await getNextCompanyCode()

  // Create Company
  const company = await Company.create({
    company_code: companyCode,
    name:        String(companyName).trim(),
    owner_name:  String(ownerName).trim(),
    biz_type:    String(businessType).trim(),
    mobile:      cleanMobile,
    email:       cleanEmail,
    gst_number:  gstNumber  ? String(gstNumber).trim()  : '',
    pan_number:  panNumber  ? String(panNumber).trim()  : '',
    address:     address    ? String(address).trim()    : '',
    city:        city       ? String(city).trim()       : '',
    state:       state      ? String(state).trim()      : '',
    pin_code:    pincode    ? String(pincode).trim()    : '',
    status:      'Pending',
  })

  // Create Company Owner user with a hashed password for sign-in
  const password_hash = await bcrypt.hash(String(password), 12)
  const user = await User.create({
    company_id: company._id,
    name:       String(ownerName).trim(),
    email:      cleanEmail,
    mobile:     cleanMobile,
    role:       'Company Owner',
    password_hash,
    is_active:  true,
  })

  sendSuccess(
    res,
    {
      userId:      user._id,
      companyId:   company._id,
      companyCode,
      nextStep:    'upload-docs',
    },
    'Registration successful. Please upload your KYC documents.',
    201
  )
}

/**
 * POST /api/wholesaler/auth/upload-docs
 * Step 2 — Upload KYC documents (multipart/form-data)
 * Fields: gst (file), pan (file), trade (file), reg (file)
 * Body:   mobile (required to identify company)
 */
async function uploadDocs(req, res) {
  const mobile = String(req.body.mobile || '').trim()
  if (!mobile) {
    return sendError(res, 'Mobile number is required to identify your registration.', 400)
  }

  const user = await User.findOne({ mobile }).lean()
  if (!user) return sendError(res, 'No registration found for this mobile number.', 404)

  const company = await Company.findById(user.company_id)
  if (!company) return sendError(res, 'Company not found.', 404)

  const fileMap = req.files || {}   // multer .fields() gives { gst:[...], pan:[...], ... }
  const updates = {}

  if (fileMap.gst   && fileMap.gst[0])   { updates.doc_gst_url   = `/uploads/kyc/${fileMap.gst[0].filename}`;   updates.docs_gst     = true }
  if (fileMap.pan   && fileMap.pan[0])   { updates.doc_pan_url   = `/uploads/kyc/${fileMap.pan[0].filename}`;   updates.docs_pan     = true }
  if (fileMap.trade && fileMap.trade[0]) { updates.doc_trade_url = `/uploads/kyc/${fileMap.trade[0].filename}`; updates.docs_biz     = true }
  if (fileMap.reg   && fileMap.reg[0])   { updates.doc_reg_url   = `/uploads/kyc/${fileMap.reg[0].filename}`;   updates.docs_address = true }

  if (Object.keys(updates).length === 0) {
    return sendError(res, 'No document files received. Please attach at least one document.', 400)
  }

  await Company.findByIdAndUpdate(company._id, updates)

  sendSuccess(
    res,
    {
      uploaded:     Object.keys(updates).filter(k => k.startsWith('doc_')).length,
      docs_gst:     updates.docs_gst     || company.docs_gst,
      docs_pan:     updates.docs_pan     || company.docs_pan,
      docs_biz:     updates.docs_biz     || company.docs_biz,
      docs_address: updates.docs_address || company.docs_address,
    },
    'Documents uploaded successfully. Your account is under review.'
  )
}

/**
 * GET /api/wholesaler/auth/me
 * Protected — returns full user + company info
 */
async function me(req, res) {
  const userDoc = await User.findById(req.user._id)
    .select('-password_hash')
    .lean()

  if (!userDoc) return sendError(res, 'User not found.', 404)

  const user = await buildUserResponse(userDoc)
  sendSuccess(res, user)
}

/**
 * POST /api/wholesaler/auth/fcm-token
 * Protected — save/update FCM push notification token
 * Body: { token, deviceInfo? }
 */
async function saveFcmToken(req, res) {
  const { token: fcmToken, deviceInfo = '' } = req.body
  if (!fcmToken) return sendError(res, 'FCM token is required.', 400)

  // Upsert session record for this user
  await WholesalerSession.findOneAndUpdate(
    { user_id: req.user._id },
    {
      user_id:     req.user._id,
      company_id:  req.user.company_id,
      fcm_token:   fcmToken,
      device_info: deviceInfo,
      is_active:   true,
      last_seen:   new Date(),
    },
    { upsert: true, new: true }
  )

  sendSuccess(res, null, 'FCM token saved.')
}

/**
 * POST /api/wholesaler/auth/logout
 * Protected — deactivate session / clear FCM token
 */
async function logout(req, res) {
  await WholesalerSession.findOneAndUpdate(
    { user_id: req.user._id },
    { is_active: false, fcm_token: '' }
  ).catch(() => {})   // non-fatal

  sendSuccess(res, null, 'Logged out successfully.')
}

module.exports = {
  checkMobile,
  sendOtpHandler,
  verifyOtpHandler,
  loginPassword,
  register,
  uploadDocs,
  me,
  saveFcmToken,
  logout,
}
