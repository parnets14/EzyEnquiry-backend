const express = require('express');
const router  = express.Router({ mergeParams: true }); // inherits :companyId from parent
const ctrl    = require('../../controllers/Company Management/branchController');

router.get   ('/',    ctrl.listBranches);
router.get   ('/:id', ctrl.getBranch);
router.post  ('/',    ctrl.createBranch);
router.put   ('/:id', ctrl.updateBranch);
router.delete('/:id', ctrl.deleteBranch);

module.exports = router;
