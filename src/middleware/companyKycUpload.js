const multer = require('multer')
const path = require('path')
const fs = require('fs')

const KYC_DIR = path.resolve(__dirname, '../../uploads/kyc')
fs.mkdirSync(KYC_DIR, { recursive: true })

const MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, KYC_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`)
  },
})

const parser = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 4 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    const expectedMime = MIME_BY_EXT[ext]
    if (expectedMime && (file.mimetype === expectedMime || (ext === '.jpg' && file.mimetype === 'image/jpg'))) {
      return cb(null, true)
    }
    const error = new Error('Only PDF, JPG, and PNG documents are supported.')
    error.status = 400
    cb(error)
  },
}).fields([
  { name: 'gst', maxCount: 1 },
  { name: 'pan', maxCount: 1 },
  { name: 'address', maxCount: 1 },
  { name: 'biz', maxCount: 1 },
])

const companyKycUpload = (req, res, next) => {
  parser(req, res, error => {
    if (!error) return next()
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'Each document must be 5 MB or smaller.' })
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ success: false, message: 'Upload one file per document field.' })
    }
    return res.status(error.status || 400).json({ success: false, message: error.message || 'Document upload failed.' })
  })
}

module.exports = { companyKycUpload }
