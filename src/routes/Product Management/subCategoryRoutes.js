const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Product Management/categoryController');

router.get   ('/',    ctrl.listSubCategories);
router.post  ('/',    ctrl.createSubCategory);
router.put   ('/:id', ctrl.updateSubCategory);
router.delete('/:id', ctrl.deleteSubCategory);

module.exports = router;
