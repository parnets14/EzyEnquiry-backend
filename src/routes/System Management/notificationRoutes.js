const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/System Management/notificationController');

router.get   ('/',              ctrl.listNotifications);
router.post  ('/',              ctrl.createNotification);       // Super Admin → send to a company
router.post  ('/broadcast',     ctrl.broadcastNotification);    // Super Admin → send to all companies
router.patch ('/mark-all-read', ctrl.markAllNotificationsRead);
router.patch ('/:id/read',      ctrl.markNotificationRead);
router.delete('/:id',           ctrl.deleteNotification);

module.exports = router;
