/**
 * Retailer Admin Routes  (Super Admin visibility + lifecycle into retailer activity)
 * Base: /api/retailer/admin   (authenticate applied at mount in server.js)
 *
 * Consumed by the CRM RetailerManagement page (src/api/retailerApi.js).
 */
const express = require('express')
const router  = express.Router()
const ctrl    = require('../../controllers/Retailer Management/retailerAdminVisibilityController')
const { validateObjectIdParam } = require('../../middleware/validateObjectId')

router.param('id', validateObjectIdParam('id'))

// ── Companies ────────────────────────────────────────────────
// GET   /api/retailer/admin/companies            — all retailer companies
router.get('/',            ctrl.listCompanies)
// GET   /api/retailer/admin/companies/:id        — single retailer company
router.get('/:id',         ctrl.getCompany)
// GET   /api/retailer/admin/companies/:id/kyc    — KYC documents
router.get('/:id/kyc',     ctrl.getCompanyKyc)
// PATCH /api/retailer/admin/companies/:id/approve
router.patch('/:id/approve',   ctrl.approveCompany)
// PATCH /api/retailer/admin/companies/:id/reject
router.patch('/:id/reject',    ctrl.rejectCompany)
// PATCH /api/retailer/admin/companies/:id/suspend
router.patch('/:id/suspend',   ctrl.suspendCompany)
// PATCH /api/retailer/admin/companies/:id/reinstate
router.patch('/:id/reinstate', ctrl.reinstateCompany)

module.exports = router
