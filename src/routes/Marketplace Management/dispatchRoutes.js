const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Marketplace Management/dispatchController');

// Proof-of-delivery image upload (field: "pod"). Shared with the retailer ERP
// surface so both write to the same uploads/pod dir with identical rules.
const { podUpload } = require('../../middleware/podUpload');

router.get   ('/',                ctrl.listDispatches);
router.post  ('/upload-pod',      podUpload, ctrl.uploadPod);
router.get   ('/:id',             ctrl.getDispatch);
router.post  ('/',                ctrl.createDispatch);
router.patch ('/:id/intransit',   ctrl.markInTransit);
router.patch ('/:id/deliver',     ctrl.markDelivered);
router.put   ('/:id',             ctrl.updateDispatch);

module.exports = router;
