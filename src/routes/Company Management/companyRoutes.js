const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Company Management/companyController');
const docCtrl = require('../../controllers/Company Management/companyDocumentController');
const { authorize } = require('../../middleware/auth');

router.get   ('/',                ctrl.listCompanies);
// KYC documents — signed-URL list (admins only). Must be before '/:id'.
router.get   ('/:id/documents',   authorize('Super Admin', 'Company Owner'), docCtrl.getCompanyDocuments);
router.get   ('/:id',             ctrl.getCompany);
router.post  ('/',                ctrl.createCompany);
router.put   ('/:id',             ctrl.updateCompany);
router.patch ('/:id/approve',     authorize('Super Admin'), ctrl.approveCompany);
router.patch ('/:id/reject',      authorize('Super Admin'), ctrl.rejectCompany);
router.patch ('/:id/docs',        ctrl.updateDocs);
router.delete('/:id',             authorize('Super Admin'), ctrl.deleteCompany);

// Branch sub-resource: /api/companies/:companyId/branches
router.use('/:companyId/branches', require('./branchRoutes'));

module.exports = router;
