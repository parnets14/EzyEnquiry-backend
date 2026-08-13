const express = require('express')
const {
  listSubCategories,
  createSubCategory,
  updateSubCategory,
  deleteSubCategory,
} = require('../controllers/productController')

const router = express.Router()

// GET  /api/sub-categories?categoryId=xxx   — filter by parent
router.get   ('/',    listSubCategories)
router.post  ('/',    createSubCategory)
router.put   ('/:id', updateSubCategory)
router.delete('/:id', deleteSubCategory)

module.exports = router
