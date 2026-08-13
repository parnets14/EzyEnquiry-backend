const express = require('express')
const { listNotifications, markNotificationRead, markAllNotificationsRead, deleteNotification } = require('../controllers/systemController')

const router = express.Router()

router.get   ('/',              listNotifications)
router.patch ('/mark-all-read', markAllNotificationsRead)
router.patch ('/:id/read',      markNotificationRead)
router.delete('/:id',           deleteNotification)

module.exports = router
