const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Marketplace Management/enquiryController');

router.get   ('/stats', ctrl.enquiryStats);
router.get   ('/',      ctrl.listEnquiries);
router.get   ('/:id',   ctrl.getEnquiry);
router.post  ('/',      ctrl.createEnquiry);
router.patch ('/:id',   ctrl.updateEnquiry);
router.delete('/:id',   ctrl.deleteEnquiry);

module.exports = router;
