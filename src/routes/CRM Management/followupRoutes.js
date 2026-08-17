const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/CRM Management/followupController');

router.get   ('/',    ctrl.listFollowups);
router.post  ('/',    ctrl.createFollowup);
router.put   ('/:id', ctrl.updateFollowup);
router.delete('/:id', ctrl.deleteFollowup);

module.exports = router;
