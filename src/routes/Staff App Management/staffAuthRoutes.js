const express = require('express')
const router  = express.Router()

const { authRateLimiter } = require('../../middleware/rateLimiter')
const {
  staffSendOtp, staffVerifyOtp,
} = require('../../controllers/Staff App Management/staffAuthController')

// ── Staff App (HR Employee) login via OTP — public, rate-limited ──
router.post('/send-otp',   authRateLimiter, staffSendOtp)
router.post('/verify-otp', authRateLimiter, staffVerifyOtp)

module.exports = router
