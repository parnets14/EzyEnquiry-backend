const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/System Management/subscriptionController');

router.get   ('/current',     ctrl.getCurrentSubscription);
router.get   ('/',            ctrl.listSubscriptions);
router.post  ('/',            ctrl.createSubscription);
router.patch ('/:id/cancel',  ctrl.cancelSubscription);

module.exports = router;
