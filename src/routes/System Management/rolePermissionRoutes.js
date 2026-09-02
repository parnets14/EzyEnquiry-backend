const express = require('express')
const router  = express.Router()
const ctrl    = require('../../controllers/System Management/rolePermissionController')
const { authorize } = require('../../middleware/auth')

// Any authenticated company user can read their own effective permissions.
router.get('/me', ctrl.myPermissions)

// Viewing / editing the full matrix is limited to admins.
router.get('/',       authorize('Super Admin', 'Company Owner'), ctrl.listRolePermissions)
router.put('/:role',  authorize('Super Admin', 'Company Owner'), ctrl.updateRolePermissions)

module.exports = router
