const express = require('express')
const { authRateLimiter } = require('../middleware/rateLimiter')
const { authenticate } = require('../middleware/auth')
const { login, sendOtp, verifyOtpHandler, me, changePassword, logout } = require('../controllers/authController')

const router = express.Router()

router.post('/login',           authRateLimiter, login)
router.post('/send-otp',        authRateLimiter, sendOtp)
router.post('/verify-otp',      authRateLimiter, verifyOtpHandler)
router.get('/me',               authenticate, me)
router.post('/change-password', authenticate, changePassword)
router.post('/logout',          authenticate, logout)

module.exports = router
