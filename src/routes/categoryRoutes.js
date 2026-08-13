const express = require('express')
const { listCategories, createCategory, updateCategory, deleteCategory } = require('../controllers/productController')

const router = express.Router()

router.get   ('/',    listCategories)
router.post  ('/',    createCategory)
router.put   ('/:id', updateCategory)
router.delete('/:id', deleteCategory)

module.exports = router
