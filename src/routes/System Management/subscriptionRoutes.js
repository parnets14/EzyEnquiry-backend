const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/System Management/subscriptionController');

// ── Admin (Super Admin) — before /:id patterns ──
router.get   ('/admin/all',     ctrl.listAllSubscriptions);
router.get   ('/admin/revenue', ctrl.revenueSummary);
router.patch ('/company/:companyId', ctrl.setCompanyPlan);

router.get   ('/current',     ctrl.getCurrentSubscription);
router.get   ('/',            ctrl.listSubscriptions);
router.post  ('/',            ctrl.createSubscription);
router.patch ('/:id/cancel',  ctrl.cancelSubscription);

module.exports = router;
