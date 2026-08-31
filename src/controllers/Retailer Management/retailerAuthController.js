const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const jwt = require('jsonwebtoken')

const User = require('../../models/User Management/User')
const Company = require('../../models/Company Management/Company')
const RetailerSession = require('../../models/Retailer Management/RetailerSession')
const RegistrationVerification = require('../../models/Retailer Management/RegistrationVerification')
const { verifyOtp } = require('../../utils/otp')
const { sendSuccess, sendError } = require('../../utils/helpers')

const OTP_PURPOSES = ['login', 'register']
const REGISTRATION_TOKEN_TTL = '10m'

function capabilities() {
  return {
    sms_otp_delivery: false,
    push_delivery: process.env.FIREBASE_ENABLED === 'true',
    payment_gateway: false,
    live_gps_tracking: false,
    cloud_document_storage: false,
  }
}

function signToken(userId) {
  return jwt.sign({ userId, app: 'retailer' }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  })
}

async function getRetailerAccount(query, includePassword = false) {
  const selection = includePassword ? '' : '-password_hash'
  const user = await User.findOne({ ...query, role: 'Retailer' }).select(selection).lean()
  if (!user) return { error: 'This mobile number is not registered. Please create an account to get started.', status: 404 }
  if (!user.is_active) return { error: 'Your account has been deactivated. Contact support.', status: 403 }

  const company = await Company.findOne({ _id: user.company_id, biz_type: 'Retailer' }).lean()
  if (!company) return { error: 'This mobile number is not registered. Please create an account to get started.', status: 404 }
  if (company.is_active === false) return { error: 'Your company account has been deactivated. Please contact support for assistance.', status: 403 }
  return { user, company }
}

function safeKycDocuments(company) {
  const documents = company?.kyc_documents || []
  const legacy = {
    gst: company?.docs_gst,
    pan: company?.docs_pan,
    trade: company?.docs_biz,
    registration: company?.docs_address,
  }
  return ['gst', 'pan', 'trade', 'registration'].map(documentType => {
    const document = documents.find(item => item.document_type === documentType)
    return {
      document_type: documentType,
      submitted: !!document || !!legacy[documentType],
      status: document?.status || (legacy[documentType] ? 'Pending' : 'NotSubmitted'),
      reject_reason: document?.status === 'Rejected' ? document.reject_reason || '' : '',
      uploaded_at: document?.uploaded_at || null,
      download_available: !!document?.file_url,
    }
  })
}

async function buildUserResponse(user, suppliedCompany = null) {
  const company = suppliedCompany || (user.company_id
    ? await Company.findById(user.company_id)
        .select('company_code name owner_name biz_type mobile email gst_number pan_number address city state pin_code status is_active reject_reason subscription_plan docs_gst docs_pan docs_address docs_biz addresses kyc_documents')
        .lean()
    : null)

  const { password_hash, ...safe } = user
  return {
    ...safe,
    company_name: company?.name || null,
    company_status: company?.status || null,
    subscription_plan: company?.subscription_plan || 'Free',
    is_approved: company?.status === 'Approved' && company?.is_active !== false,
    capabilities: capabilities(),
    kyc_documents: safeKycDocuments(company),
    company: company ? {
      id: company._id,
      company_code: company.company_code || '',
      name: company.name || '',
      owner_name: company.owner_name || '',
      biz_type: company.biz_type || '',
      mobile: company.mobile || '',
      email: company.email || '',
      gst_number: company.gst_number || '',
      pan_number: company.pan_number || '',
      address: company.address || '',
      city: company.city || '',
      state: company.state || '',
      pin_code: company.pin_code || '',
      addresses: company.addresses || [],
      status: company.status || '',
      is_active: company.is_active !== false,
      reject_reason: company.status === 'Rejected' ? company.reject_reason || '' : '',
      subscription_plan: company.subscription_plan || 'Free',
    } : null,
  }
}

async function checkMobile(req, res) {
  const mobile = String(req.body.mobile || '').trim()
  if (!/^\d{10}$/.test(mobile)) {
    return sendError(res, 'Please provide a valid 10-digit mobile number.', 400)
  }
  const user = await User.findOne({ mobile, role: 'Retailer' }).select('_id').lean()
  sendSuccess(res, { exists: !!user })
}

async function sendOtpHandler(req, res) {
  const mobile = String(req.body.mobile || '').trim()
  const purpose = String(req.body.purpose || 'login')

  if (!/^\d{10}$/.test(mobile)) return sendError(res, 'Please provide a valid 10-digit mobile number.', 400)
  if (!OTP_PURPOSES.includes(purpose)) return sendError(res, 'purpose must be login or register.', 400)

  if (purpose === 'login') {
    const account = await getRetailerAccount({ mobile })
    if (account.error) return sendError(res, account.error, account.status)
  } else {
    const exists = await User.exists({ mobile })
    if (exists) return sendError(res, 'This mobile number is already registered.', 409)
  }

  // In development mode, generate and store the OTP so verifyOtp works
  const { generateOtp, storeOtp } = require('../../utils/otp')
  const otp = generateOtp()
  await storeOtp(mobile, otp, purpose, 'mobile')

  // Dev mode: return OTP in response for testing. In production, send via SMS.
  if (process.env.OTP_DEV_RETURN === 'true' || process.env.NODE_ENV === 'development') {
    return sendSuccess(res, { otp, message_sent: false, capabilities: capabilities() }, 'OTP generated (dev mode). Use this OTP to verify.')
  }

  // Production: SMS provider not configured
  return res.status(503).json({
    success: false,
    message: 'SMS OTP delivery is not configured. No OTP was sent.',
    data: { capabilities: capabilities() },
  })
}

async function verifyOtpHandler(req, res) {
  const mobile = String(req.body.mobile || '').trim()
  const otpValue = String(req.body.otp || '').trim()
  const purpose = String(req.body.purpose || 'login')

  if (!/^\d{10}$/.test(mobile) || !otpValue) return sendError(res, 'Valid mobile number and OTP are required.', 400)
  if (!OTP_PURPOSES.includes(purpose)) return sendError(res, 'purpose must be login or register.', 400)

  const result = await verifyOtp(mobile, otpValue, purpose)
  if (!result.valid) return sendError(res, result.reason || 'Invalid or expired OTP.', 400)

  if (purpose === 'register') {
    if (await User.exists({ mobile })) return sendError(res, 'This mobile number is already registered.', 409)
    const grant = await RegistrationVerification.create({
      mobile,
      expires_at: new Date(Date.now() + 10 * 60 * 1000),
    })
    const verificationToken = jwt.sign(
      { type: 'retailer_registration', mobile, verificationId: grant._id.toString() },
      process.env.JWT_SECRET,
      { expiresIn: REGISTRATION_TOKEN_TTL }
    )
    return sendSuccess(res, { verified: true, verification_token: verificationToken, expires_in_seconds: 600 }, 'OTP verified.')
  }

  const account = await getRetailerAccount({ mobile })
  if (account.error) return sendError(res, account.error, account.status)
  await User.findByIdAndUpdate(account.user._id, { last_login: new Date() })
  const user = await buildUserResponse(account.user, account.company)
  return sendSuccess(res, { token: signToken(account.user._id), user }, 'OTP verified. Login successful.')
}

async function loginPassword(req, res) {
  const identifier = String(req.body.identifier || req.body.mobile || req.body.email || '').trim()
  const password = String(req.body.password || '')
  if (!identifier || !password) return sendError(res, 'Mobile/email and password are required.', 400)

  const query = /^\d{10}$/.test(identifier) ? { mobile: identifier } : { email: identifier.toLowerCase() }
  const account = await getRetailerAccount(query, true)
  if (account.error) return sendError(res, account.error, account.status)
  if (!account.user.password_hash) return sendError(res, 'This account has no password set. Use OTP login when SMS delivery is available.', 400)

  const valid = await bcrypt.compare(password, account.user.password_hash)
  if (!valid) return sendError(res, 'Invalid mobile/email or password.', 401)

  await User.findByIdAndUpdate(account.user._id, { last_login: new Date() })
  const user = await buildUserResponse(account.user, account.company)
  return sendSuccess(res, { token: signToken(account.user._id), user }, 'Login successful.')
}

async function register(req, res) {
  const {
    companyName, ownerName, mobile, email, password,
    gstNumber, panNumber, address, city, state, pincode,
  } = req.body
  let { verificationToken } = req.body

  // Dev mode bypass: auto-generate verification token if not provided
  if (!verificationToken && (process.env.OTP_DEV_RETURN === 'true' || process.env.NODE_ENV === 'development')) {
    const cleanMobile = String(mobile || '').trim()
    if (/^\d{10}$/.test(cleanMobile)) {
      const grant = await RegistrationVerification.create({
        mobile: cleanMobile,
        expires_at: new Date(Date.now() + 10 * 60 * 1000),
      })
      verificationToken = jwt.sign(
        { type: 'retailer_registration', mobile: cleanMobile, verificationId: grant._id.toString() },
        process.env.JWT_SECRET,
        { expiresIn: REGISTRATION_TOKEN_TTL }
      )
    }
  }

  const required = { companyName, ownerName, mobile, email, verificationToken }
  for (const [field, value] of Object.entries(required)) {
    if (!value || !String(value).trim()) return sendError(res, `${field} is required.`, 400)
  }

  const cleanMobile = String(mobile).trim()
  const cleanEmail = String(email).toLowerCase().trim()
  if (!/^\d{10}$/.test(cleanMobile)) return sendError(res, 'Mobile must be exactly 10 digits.', 400)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return sendError(res, 'Please provide a valid email address.', 400)
  if (password && String(password).length < 6) return sendError(res, 'Password must be at least 6 characters.', 400)

  let decoded
  try {
    decoded = jwt.verify(String(verificationToken), process.env.JWT_SECRET)
  } catch (_error) {
    return sendError(res, 'Registration verification token is invalid or expired.', 401)
  }
  if (decoded.type !== 'retailer_registration' || decoded.mobile !== cleanMobile || !decoded.verificationId) {
    return sendError(res, 'Registration verification token does not match this mobile number.', 401)
  }

  const [existingMobile, existingEmail] = await Promise.all([
    User.exists({ mobile: cleanMobile }),
    User.exists({ email: cleanEmail }),
  ])
  if (existingMobile) return sendError(res, 'This mobile number is already registered.', 409)
  if (existingEmail) return sendError(res, 'This email address is already registered.', 409)

  const grant = await RegistrationVerification.findOneAndUpdate(
    { _id: decoded.verificationId, mobile: cleanMobile, used_at: null, expires_at: { $gt: new Date() } },
    { used_at: new Date() },
    { new: true }
  ).lean()
  if (!grant) return sendError(res, 'Registration verification token has expired or already been used.', 401)

  let company
  try {
    const companyCode = `RET${Date.now().toString().slice(-7)}${crypto.randomInt(100, 999)}`
    company = await Company.create({
      company_code: companyCode,
      name: String(companyName).trim(),
      owner_name: String(ownerName).trim(),
      biz_type: 'Retailer',
      mobile: cleanMobile,
      email: cleanEmail,
      gst_number: gstNumber ? String(gstNumber).trim() : '',
      pan_number: panNumber ? String(panNumber).trim() : '',
      address: address ? String(address).trim() : '',
      city: city ? String(city).trim() : '',
      state: state ? String(state).trim() : '',
      pin_code: pincode ? String(pincode).trim() : '',
      status: 'Pending',
      is_active: true,
    })

    const userData = {
      company_id: company._id,
      name: String(ownerName).trim(),
      email: cleanEmail,
      mobile: cleanMobile,
      role: 'Retailer',
      is_active: true,
    }
    if (password) userData.password_hash = await bcrypt.hash(String(password), 12)
    const user = await User.create(userData)
    const userResponse = await buildUserResponse(user.toObject(), company.toObject())

    return sendSuccess(res, {
      token: signToken(user._id),
      user: userResponse,
      next_step: 'upload-docs',
    }, 'Registration successful. Your account is pending admin approval.', 201)
  } catch (error) {
    if (company?._id) await Company.deleteOne({ _id: company._id }).catch(() => {})
    await RegistrationVerification.updateOne({ _id: decoded.verificationId }, { used_at: null }).catch(() => {})
    if (error?.code === 11000) return sendError(res, 'Mobile, email, or company code is already registered.', 409)
    throw error
  }
}

async function uploadDocs(req, res) {
  const company = await Company.findById(req.user.company_id)
  if (!company || company.biz_type !== 'Retailer') return sendError(res, 'Retailer company not found.', 404)

  const files = req.files || {}
  const incoming = {
    gst: files.gst?.[0],
    pan: files.pan?.[0],
    trade: files.trade?.[0],
    registration: files.registration?.[0] || files.reg?.[0],
  }
  const received = Object.entries(incoming).filter(([, file]) => !!file)
  if (!received.length) return sendError(res, 'Attach at least one KYC document.', 400)

  for (const [documentType, file] of received) {
    const fileUrl = `/uploads/kyc/${file.filename}`
    const index = company.kyc_documents.findIndex(item => item.document_type === documentType)
    const document = {
      document_type: documentType,
      file_url: fileUrl,
      status: 'Pending',
      reject_reason: '',
      uploaded_at: new Date(),
      reviewed_at: null,
    }
    if (index >= 0) company.kyc_documents[index] = document
    else company.kyc_documents.push(document)

    if (documentType === 'gst') { company.doc_gst_url = fileUrl; company.docs_gst = true }
    if (documentType === 'pan') { company.doc_pan_url = fileUrl; company.docs_pan = true }
    if (documentType === 'trade') { company.doc_trade_url = fileUrl; company.docs_biz = true }
    if (documentType === 'registration') { company.doc_reg_url = fileUrl; company.docs_address = true }
  }

  await company.save()
  return sendSuccess(res, {
    uploaded: received.map(([documentType]) => documentType),
    documents: safeKycDocuments(company.toObject()),
  }, 'Documents uploaded and marked pending review.')
}

async function me(req, res) {
  const userDoc = await User.findById(req.user._id).select('-password_hash').lean()
  if (!userDoc) return sendError(res, 'User not found.', 404)
  return sendSuccess(res, await buildUserResponse(userDoc))
}

async function saveFcmToken(req, res) {
  const fcmToken = String(req.body.token || '').trim()
  const deviceInfo = String(req.body.deviceInfo || '').trim().slice(0, 500)
  if (!fcmToken) return sendError(res, 'FCM token is required.', 400)

  // A physical device token must never remain attached to a previously logged-in user.
  await RetailerSession.updateMany(
    { fcm_token: fcmToken, user_id: { $ne: req.user._id } },
    { $set: { fcm_token: '', is_active: false } }
  )

  await RetailerSession.findOneAndUpdate(
    { user_id: req.user._id },
    {
      user_id: req.user._id,
      company_id: req.user.company_id,
      fcm_token: fcmToken,
      device_info: deviceInfo,
      is_active: true,
      last_seen: new Date(),
    },
    { upsert: true, new: true }
  )
  return sendSuccess(
    res,
    { push_delivery_available: process.env.FIREBASE_ENABLED === 'true' },
    'Device token stored successfully.'
  )
}

async function logout(req, res) {
  await RetailerSession.updateMany(
    { user_id: req.user._id },
    { $set: { is_active: false, fcm_token: '' } }
  ).catch(() => {})
  return sendSuccess(res, null, 'Logged out successfully.')
}

module.exports = {
  capabilities,
  safeKycDocuments,
  buildUserResponse,
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
