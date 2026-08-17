const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Finance Management/quotationController');

router.get   ('/',           ctrl.listQuotations);
router.get   ('/:id',        ctrl.getQuotation);
router.post  ('/',           ctrl.createQuotation);
router.put   ('/:id',        ctrl.updateQuotation);
router.patch ('/:id/status', ctrl.updateQuotationStatus);
router.delete('/:id',        ctrl.deleteQuotation);

module.exports = router;
