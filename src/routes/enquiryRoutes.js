const express = require('express')
const { authorize } = require('../middleware/auth')
const { listEnquiries, getEnquiry, createEnquiry, updateEnquiry, deleteEnquiry, enquiryStats } = require('../controllers/enquiryController')

const router = express.Router()

// Anyone authenticated can view stats and list (controller filters by role internally)
router.get   ('/stats',  enquiryStats)
router.get   ('/',       listEnquiries)
router.get   ('/:id',    getEnquiry)

// Create — Retailer + Sales staff (controller enforces this)
router.post  ('/',       createEnquiry)

// Update — status changes restricted in controller for Retailers
router.patch ('/:id',    updateEnquiry)

// Delete — Manager/Admin only
router.delete('/:id',    authorize('Manager', 'Company Owner', 'Super Admin'), deleteEnquiry)

module.exports = router
