const express = require('express')
const {
  getDashboardStats,
  getSalesReport,
  getPurchaseReport,
  getExpenseReport,
} = require('../controllers/systemController')

const router = express.Router()

router.get('/dashboard', getDashboardStats)
router.get('/sales',     getSalesReport)
router.get('/purchases', getPurchaseReport)
router.get('/expenses',  getExpenseReport)

module.exports = router
