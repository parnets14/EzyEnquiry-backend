const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/User Management/userController');
const { authorize } = require('../../middleware/auth');

router.get   ('/',                   authorize('Super Admin', 'Company Owner', 'Manager'), ctrl.listUsers);
router.get   ('/:id',                ctrl.getUser);
router.post  ('/',                   authorize('Super Admin', 'Company Owner'), ctrl.createUser);
router.put   ('/:id',                authorize('Super Admin', 'Company Owner'), ctrl.updateUser);
router.delete('/:id',                authorize('Super Admin', 'Company Owner'), ctrl.deleteUser);
router.patch ('/:id/reset-password', authorize('Super Admin', 'Company Owner'), ctrl.resetPassword);

module.exports = router;
