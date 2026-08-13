const express = require('express')
const { listExpenses, createExpense, updateExpense, deleteExpense } = require('../controllers/financeController')

const router = express.Router()

router.get   ('/',    listExpenses)
router.post  ('/',    createExpense)
router.put   ('/:id', updateExpense)
router.delete('/:id', deleteExpense)

module.exports = router
