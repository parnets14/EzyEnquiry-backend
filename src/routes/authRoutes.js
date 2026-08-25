const express    = require('express')
const multer     = require('multer')
const path       = require('path')
const fs         = require('fs')
const { authRateLimiter } = require('../middleware/rateLimiter')
const { authenticate }    = require('../middleware/auth')
const {
  login, sendOtp, verifyOtpHandler, me, changePassword,
  logout, register, uploadDocs, checkMobile,
} = require('../controllers/authController')

const router = express.Router()

// ── Multer for KYC document uploads (public — no auth yet) ───
const KYC_DIR = path.join(__dirname, '../../uploads/kyc')
if (!fs.existsSync(KYC_DIR)) fs.mkdirSync(KYC_DIR, { recursive: true })

const kycStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, KYC_DIR),
  filename:    (_req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase()
    const name = `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`
    cb(null, name)
  },
})
const kycUpload = multer({
  storage: kycStorage,
  limits:  { fileSize: 5 * 1024 * 1024 }, // 5 MB per file
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg','image/jpg','image/png','image/webp','application/pdf']
    allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only images and PDFs allowed'))
  },
}).fields([
  { name: 'gst',   maxCount: 1 },
  { name: 'pan',   maxCount: 1 },
  { name: 'trade', maxCount: 1 },
  { name: 'reg',   maxCount: 1 },
])

// ── Public Routes ────────────────────────────────────────────
router.post('/register',      authRateLimiter, register)
router.post('/upload-docs',   kycUpload, uploadDocs)
router.post('/check-mobile',  authRateLimiter, checkMobile)
router.post('/login',         authRateLimiter, login)
router.post('/send-otp',      authRateLimiter, sendOtp)
router.post('/verify-otp',    authRateLimiter, verifyOtpHandler)

// ── Protected Routes ─────────────────────────────────────────
router.get  ('/me',             authenticate, me)
router.post ('/change-password',authenticate, changePassword)
router.post ('/logout',         authenticate, logout)

module.exports = router
