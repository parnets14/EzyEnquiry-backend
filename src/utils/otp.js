const bcrypt    = require('bcryptjs')
const OtpStore  = require('../models/System Management/OtpStore')

const OTP_LENGTH  = parseInt(process.env.OTP_LENGTH          || '6')
const OTP_EXPIRES = parseInt(process.env.OTP_EXPIRES_MINUTES || '10')

/** Generate a numeric OTP */
function generateOtp() {
  return String(Math.floor(Math.random() * Math.pow(10, OTP_LENGTH))).padStart(OTP_LENGTH, '0')
}

/** Store OTP hash in DB */
async function storeOtp(target, otp, purpose = 'login', type = 'email') {
  const normalised = String(target).trim()
  const hash       = await bcrypt.hash(otp, 10)
  const expiresAt  = new Date(Date.now() + OTP_EXPIRES * 60 * 1000)

  // Invalidate previous unused OTPs for same target + purpose
  await OtpStore.updateMany(
    { target: normalised, purpose, used: false },
    { used: true }
  )

  await OtpStore.create({ target: normalised, type, otp_hash: hash, purpose, expires_at: expiresAt })
  return otp
}

/** Verify OTP */
async function verifyOtp(target, otp, purpose = 'login') {
  const normalised = String(target).trim()
  const otpStr     = String(otp).trim()

  // Debug: log what we're looking for
  console.log(`[OTP Verify] target="${normalised}" otp="${otpStr}" purpose="${purpose}"`)

  const record = await OtpStore.findOne({
    target:     normalised,
    purpose,
    used:       false,
    expires_at: { $gt: new Date() },
  }).sort({ created_at: -1 })

  if (!record) {
    console.log(`[OTP Verify] No valid record found for target="${normalised}"`)
    return { valid: false, reason: 'OTP expired or not found' }
  }

  console.log(`[OTP Verify] Record found, comparing hash...`)
  const match = await bcrypt.compare(otpStr, record.otp_hash)
  if (!match) {
    console.log(`[OTP Verify] Hash mismatch for target="${normalised}"`)
    return { valid: false, reason: 'Invalid OTP' }
  }

  await OtpStore.findByIdAndUpdate(record._id, { used: true })
  console.log(`[OTP Verify] SUCCESS for target="${normalised}"`)
  return { valid: true }
}

module.exports = { generateOtp, storeOtp, verifyOtp }
