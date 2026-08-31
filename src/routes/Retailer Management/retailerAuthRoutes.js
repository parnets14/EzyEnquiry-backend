const express = require('express')

const { authRateLimiter } = require('../../middleware/rateLimiter')
const { authenticate } = require('../../middleware/auth')
const { requireRetailerIdentity } = require('../../middleware/retailerAccess')
const { retailerKycUpload } = require('../../middleware/retailerKycUpload')
const ctrl = require('../../controllers/Retailer Management/retailerAuthController')

const router = express.Router()

router.post('/check-mobile', authRateLimiter, ctrl.checkMobile)
router.post('/send-otp', authRateLimiter, ctrl.sendOtpHandler)
router.post('/verify-otp', authRateLimiter, ctrl.verifyOtpHandler)
router.post('/login', authRateLimiter, ctrl.loginPassword)
router.post('/register', authRateLimiter, ctrl.register)

router.use(authenticate, requireRetailerIdentity)
router.post('/upload-docs', retailerKycUpload, ctrl.uploadDocs)
router.get('/me', ctrl.me)
router.post('/fcm-token', ctrl.saveFcmToken)
router.post('/logout', ctrl.logout)

module.exports = router
