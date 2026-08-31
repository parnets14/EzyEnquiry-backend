const multer = require('multer')
const path = require('path')
const fs = require('fs')

const KYC_DIR = path.join(__dirname, '../../uploads/kyc')
if (!fs.existsSync(KYC_DIR)) fs.mkdirSync(KYC_DIR, { recursive: true })

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, KYC_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`)
  },
})

const retailerKycUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 4 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only JPEG, PNG, WebP images and PDF files are allowed.'))
    }
    cb(null, true)
  },
}).fields([
  { name: 'gst', maxCount: 1 },
  { name: 'pan', maxCount: 1 },
  { name: 'trade', maxCount: 1 },
  { name: 'registration', maxCount: 1 },
  { name: 'reg', maxCount: 1 },
])

module.exports = { retailerKycUpload, KYC_DIR }
