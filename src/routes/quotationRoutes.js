const express = require('express')
const {
  listQuotations, getQuotation, createQuotation,
  updateQuotation, updateQuotationStatus, deleteQuotation,
} = require('../controllers/quotationController')

const router = express.Router()

router.get   ('/',            listQuotations)
router.get   ('/:id',         getQuotation)
router.post  ('/',            createQuotation)
router.put   ('/:id',         updateQuotation)
router.patch ('/:id/status',  updateQuotationStatus)
router.delete('/:id',         deleteQuotation)

module.exports = router
