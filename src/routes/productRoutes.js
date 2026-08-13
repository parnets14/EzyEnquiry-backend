const express = require('express')
const {
  listProducts, getProduct, createProduct, updateProduct, deleteProduct,
  searchProducts, restoreProduct, getRecycleBin,
} = require('../controllers/productController')
const { uploadImages } = require('../middleware/upload')

const router = express.Router()

router.get   ('/search',             searchProducts)
router.get   ('/recycle-bin',        getRecycleBin)
router.post  ('/:id/restore',        restoreProduct)
router.get   ('/',                   listProducts)
router.get   ('/:id',                getProduct)
router.post  ('/',                   (req, res, next) => uploadImages(req, res, (err) => { if (err) return res.status(400).json({ success: false, message: err.message }); next() }), createProduct)
router.put   ('/:id',                (req, res, next) => uploadImages(req, res, (err) => { if (err) return res.status(400).json({ success: false, message: err.message }); next() }), updateProduct)
router.delete('/:id',                deleteProduct)

module.exports = router
