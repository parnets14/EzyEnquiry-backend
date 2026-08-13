const express = require('express')
const { authorize } = require('../middleware/auth')
const {
  listCompanies, getCompany, createCompany, approveCompany,
  rejectCompany, updateCompany, deleteCompany, updateDocs,
} = require('../controllers/companyController')
const branchRoutes = require('./branchRoutes')

const router = express.Router()

router.get   ('/',              authorize('Super Admin', 'Admin'), listCompanies)
router.get   ('/:id',           getCompany)
router.post  ('/',              createCompany)
router.patch ('/:id/approve',   authorize('Super Admin'), approveCompany)
router.patch ('/:id/reject',    authorize('Super Admin'), rejectCompany)
router.put   ('/:id',           updateCompany)
router.delete('/:id',           authorize('Super Admin'), deleteCompany)
router.patch ('/:id/docs',      updateDocs)

// ── Branch sub-resource ─────────────────────────────────────
// GET/POST   /api/companies/:companyId/branches
// GET/PUT/DELETE  /api/companies/:companyId/branches/:id
router.use('/:companyId/branches', branchRoutes)

module.exports = router
