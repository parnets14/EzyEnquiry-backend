const bcrypt  = require('bcryptjs')
const jwt     = require('jsonwebtoken')
const User    = require('../models/User Management/User')
const Company = require('../models/Company Management/Company')
const { generateOtp, storeOtp, verifyOtp } = require('../utils/otp')
const { sendOtpMail }            = require('../utils/mailer')
const { sendSuccess, sendError } = require('../utils/helpers')

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
  const { target, type = 'email', purpose = 'login' } = req.body
  if (!target) return sendError(res, 'Email or mobile is required.')

  const otp = generateOtp()
  await storeOtp(target, otp, purpose, type)
  if (type === 'email') await sendOtpMail(target, otp, purpose)

  sendSuccess(res, { sent: true }, `OTP sent to ${type === 'email' ? 'email' : 'mobile'}`)
}

/** POST /api/auth/verify-otp */
async function verifyOtpHandler(req, res) {
  const { target, otp, purpose = 'login' } = req.body
  if (!target || !otp) return sendError(res, 'Target and OTP are required.')

  const result = await verifyOtp(target, otp, purpose)
  if (!result.valid) return sendError(res, result.reason, 400)

  if (purpose === 'login') {
    const user = await User.findOne({ $or: [{ email: target }, { mobile: target }] })
      .select('-password_hash')
      .lean()
    if (!user)           return sendError(res, 'User not found.', 404)
    if (!user.is_active) return sendError(res, 'Account deactivated.', 403)

    await User.findByIdAndUpdate(user._id, { last_login: new Date() })
    const token = signToken(user._id)
    return sendSuccess(res, { token, user }, 'OTP verified. Login successful.')
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

module.exports = { login, sendOtp, verifyOtpHandler, me, changePassword, logout }
