const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const Notification = require('../../models/System Management/Notification');

/** GET /api/notifications */
async function listNotifications(req, res) {
  const { is_read, page = 1, limit = 30 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const query  = { company_id: req.user.company_id };
  if (is_read !== undefined) query.is_read = is_read === 'true';

  const [total, notifications, unreadCount] = await Promise.all([
    Notification.countDocuments(query),
    Notification.find(query).sort({ created_at: -1 }).skip(offset).limit(parseInt(limit)).lean(),
    Notification.countDocuments({ company_id: req.user.company_id, is_read: false }),
  ]);
  sendSuccess(res, { notifications, unreadCount, pagination: paginate(total, parseInt(page), parseInt(limit)) });
}

/** PATCH /api/notifications/:id/read */
async function markNotificationRead(req, res) {
  const notif = await Notification.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    { is_read: true },
    { new: true }
  ).lean();
  if (!notif) return sendError(res, 'Notification not found.', 404);
  sendSuccess(res, notif, 'Notification marked as read.');
}

/** PATCH /api/notifications/mark-all-read */
async function markAllNotificationsRead(req, res) {
  const result = await Notification.updateMany(
    { company_id: req.user.company_id, is_read: false },
    { is_read: true }
  );
  sendSuccess(res, { updated: result.modifiedCount }, 'All notifications marked as read.');
}

/** DELETE /api/notifications/:id */
async function deleteNotification(req, res) {
  const result = await Notification.deleteOne({ _id: req.params.id, company_id: req.user.company_id });
  if (result.deletedCount === 0) return sendError(res, 'Notification not found.', 404);
  sendSuccess(res, null, 'Notification deleted.');
}

module.exports = { listNotifications, markNotificationRead, markAllNotificationsRead, deleteNotification };
