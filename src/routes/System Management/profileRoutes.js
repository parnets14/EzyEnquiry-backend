const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/System Management/profileController');

router.get ('/',                ctrl.getProfile);
router.put ('/',                ctrl.updateProfile);
router.post('/change-password', ctrl.changePassword);

module.exports = router;
