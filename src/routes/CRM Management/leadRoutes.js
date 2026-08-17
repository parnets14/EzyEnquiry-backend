const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/CRM Management/leadController');

router.get   ('/',            ctrl.listLeads);
router.post  ('/',            ctrl.createLead);
router.put   ('/:id',         ctrl.updateLead);
router.patch ('/:id/convert', ctrl.convertLead);
router.delete('/:id',         ctrl.deleteLead);

module.exports = router;
