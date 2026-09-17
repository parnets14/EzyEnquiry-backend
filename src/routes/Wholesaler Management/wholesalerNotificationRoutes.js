/**
 * Wholesaler Notification Routes
 * Base: /api/wholesaler/notifications
 * Re-uses the same notification controller used by Staff and ERP routes.
 */
const express = require('express')
const ctrl    = require('../../controllers/System Management/notificationController')

const router = express.Router()

router.get   ('/',                ctrl.listNotifications)
router.patch ('/mark-all-read',   ctrl.markAllNotificationsRead)
router.patch ('/:id/read',        ctrl.markNotificationRead)
router.delete('/:id',             ctrl.deleteNotification)

module.exports = router
