const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Product Management/categoryController');

router.get   ('/',    ctrl.listCategories);
router.post  ('/',    ctrl.createCategory);
router.put   ('/:id', ctrl.updateCategory);
router.delete('/:id', ctrl.deleteCategory);

module.exports = router;
