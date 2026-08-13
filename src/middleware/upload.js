const multer = require('multer')
const path   = require('path')
const fs     = require('fs')

const MAX_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB || '10') * 1024 * 1024

const ALLOWED_TYPES = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]

function makeStorage(folder) {
  const dest = path.join(__dirname, '../../uploads', folder)
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true })

  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dest),
    filename:    (_req, file, cb) => {
      const ext  = path.extname(file.originalname).toLowerCase()
      const name = `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`
      cb(null, name)
    },
  })
}

function createUploader(folder, fieldName = 'file', maxCount = 1) {
  return multer({
    storage:  makeStorage(folder),
    limits:   { fileSize: MAX_SIZE },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_TYPES.includes(file.mimetype)) {
        cb(null, true)
      } else {
        cb(new Error(`File type ${file.mimetype} not allowed`))
      }
    },
  }).array(fieldName, maxCount)
}

// Single file upload middleware factory
const uploadDocs   = createUploader('documents', 'file', 5)
const uploadImages = createUploader('images',    'file', 10)
const uploadAvatar = createUploader('avatars',   'file', 1)

module.exports = { uploadDocs, uploadImages, uploadAvatar, createUploader }
