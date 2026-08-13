const express = require('express')
const { listBrands, createBrand, updateBrand, deleteBrand } = require('../controllers/productController')

const router = express.Router()

router.get   ('/',    listBrands)
router.post  ('/',    createBrand)
router.put   ('/:id', updateBrand)
router.delete('/:id', deleteBrand)

module.exports = router
