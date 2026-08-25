/**
 * Wholesaler App — Auth Routes
 * Base: /api/wholesaler/auth
 */
const express = require('express')
const multer  = require('multer')
const path    = require('path')
const fs      = require('fs')

const { authRateLimiter } = require('../../middleware/rateLimiter')
const { authenticate }    = require('../../middleware/auth')
const ctrl = require('../../controllers/Wholesaler Management/wholesalerAuthController')

const router = express.Router()

// ── Multer — KYC document uploads ────────────────────────────
const KYC_DIR = path.join(__dirname, '../../../uploads/kyc')
if (!fs.existsSync(KYC_DIR)) fs.mkdirSync(KYC_DIR, { recursive: true })

const kycStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, KYC_DIR),
  filename:    (_req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase()
    const name = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`
    cb(null, name)
  },
})

const kycUpload = multer({
  storage: kycStorage,
  limits:  { fileSize: 5 * 1024 * 1024 },   // 5 MB per file
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']
    if (allowed.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Only JPEG, PNG, WebP images and PDF files are allowed.'))
    }
  },
}).fields([
  { name: 'gst',   maxCount: 1 },
  { name: 'pan',   maxCount: 1 },
  { name: 'trade', maxCount: 1 },
  { name: 'reg',   maxCount: 1 },
])

// ── Public Routes ─────────────────────────────────────────────────────────────

// Check if mobile is registered → WelcomeScreen routing
router.post('/check-mobile', authRateLimiter, ctrl.checkMobile)

// Send OTP to mobile number
router.post('/send-otp', authRateLimiter, ctrl.sendOtpHandler)

// Verify OTP → returns JWT token on success
router.post('/verify-otp', authRateLimiter, ctrl.verifyOtpHandler)

// Register new wholesaler company (Step 1)
router.post('/register', authRateLimiter, ctrl.register)

// Upload KYC documents (Step 2) — no auth required yet
router.post('/upload-docs', kycUpload, ctrl.uploadDocs)

// ── Protected Routes ──────────────────────────────────────────────────────────

// Get current user profile + company status
router.get('/me', authenticate, ctrl.me)

// Save FCM push notification token
router.post('/fcm-token', authenticate, ctrl.saveFcmToken)

// Logout — clear FCM token
router.post('/logout', authenticate, ctrl.logout)

module.exports = router
