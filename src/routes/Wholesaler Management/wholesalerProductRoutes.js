/**
 * Wholesaler Product Catalog Routes
 * Base: /api/wholesaler/products
 *
 * All routes require authentication.
 * Wholesaler = View Only. No create / edit / delete / rate-setting.
 */
const express = require('express')
const multer  = require('multer')
const path    = require('path')
const fs      = require('fs')
const router  = express.Router()
const ctrl    = require('../../controllers/Wholesaler Management/wholesalerProductController')

// ── Multer — product image uploads ───────────────────────────
const PRODUCT_DIR = path.join(__dirname, '../../../uploads/products')
if (!fs.existsSync(PRODUCT_DIR)) fs.mkdirSync(PRODUCT_DIR, { recursive: true })

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PRODUCT_DIR),
    filename:    (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase()
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`)
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.mimetype)
    cb(ok ? null : new Error('Only JPEG, PNG, WebP images are allowed.'), ok)
  },
}).single('image')

// Bulk import spreadsheet (field: "file") — .xlsx / .csv
const sheetUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PRODUCT_DIR),
    filename:    (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.xlsx'
      cb(null, `import-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`)
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xlsx|xls|csv)$/i.test(file.originalname)
    cb(ok ? null : new Error('Only .xlsx, .xls or .csv files are allowed.'), ok)
  },
}).single('file')

// Catalogue / price-list PDF upload (field: "doc")
const docUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PRODUCT_DIR),
    filename:    (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.pdf'
      cb(null, `catalog-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`)
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === 'application/pdf'
    cb(ok ? null : new Error('Only PDF files are allowed.'), ok)
  },
}).single('doc')

// Must be before /:id to avoid route conflict
router.get('/filters', ctrl.getFilters)

// Wholesaler's own products (created by them)
router.get('/mine', ctrl.listMyProducts)

// Upload a product image → returns { url }
router.post('/upload-image', imageUpload, ctrl.uploadProductImage)

// Upload a catalogue / price-list PDF → returns { url }
router.post('/upload-doc', docUpload, ctrl.uploadProductDoc)

// Bulk import products (create + price update) from Excel/CSV → { created, updated, skipped }
router.post('/bulk-import', sheetUpload, ctrl.bulkImportProducts)

// Create a product (wholesaler adds their own item)
router.post('/', ctrl.createProduct)

// Catalog list
router.get('/',    ctrl.listCatalog)

// Single product detail
router.get('/:id', ctrl.getCatalogProduct)

// Update own product
router.put('/:id', ctrl.updateProduct)

// Delete own product
router.delete('/:id', ctrl.deleteProduct)

module.exports = router
