const express = require('express')
const { listSales, createSale } = require('../controllers/financeController')

const router = express.Router()

router.get ('/',  listSales)
router.post('/',  createSale)

module.exports = router
