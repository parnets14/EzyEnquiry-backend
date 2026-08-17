const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Product Management/brandController');

router.get   ('/',    ctrl.listBrands);
router.post  ('/',    ctrl.createBrand);
router.put   ('/:id', ctrl.updateBrand);
router.delete('/:id', ctrl.deleteBrand);

module.exports = router;
