const express = require('express')
const { listEnquiries, getEnquiry, createEnquiry, updateEnquiry, deleteEnquiry, enquiryStats } = require('../controllers/enquiryController')

const router = express.Router()

router.get   ('/stats',  enquiryStats)
router.get   ('/',       listEnquiries)
router.get   ('/:id',    getEnquiry)
router.post  ('/',       createEnquiry)
router.patch ('/:id',    updateEnquiry)
router.delete('/:id',    deleteEnquiry)

module.exports = router
