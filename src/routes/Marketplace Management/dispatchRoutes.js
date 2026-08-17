const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Marketplace Management/dispatchController');

router.get   ('/',            ctrl.listDispatches);
router.get   ('/:id',         ctrl.getDispatch);
router.post  ('/',            ctrl.createDispatch);
router.patch ('/:id/deliver', ctrl.markDelivered);
router.put   ('/:id',         ctrl.updateDispatch);

module.exports = router;
