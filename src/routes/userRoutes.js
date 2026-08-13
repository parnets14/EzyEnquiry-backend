const express = require('express')
const { authorize } = require('../middleware/auth')
const { listUsers, getUser, createUser, updateUser, deleteUser, resetPassword } = require('../controllers/userController')

const router = express.Router()

router.get   ('/',              authorize('Super Admin','Company Owner','Manager'), listUsers)
router.get   ('/:id',           getUser)
router.post  ('/',              authorize('Super Admin','Company Owner'), createUser)
router.put   ('/:id',           authorize('Super Admin','Company Owner'), updateUser)
router.delete('/:id',           authorize('Super Admin','Company Owner'), deleteUser)
router.patch ('/:id/reset-password', authorize('Super Admin','Company Owner'), resetPassword)

module.exports = router
