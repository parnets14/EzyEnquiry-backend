const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const Notification = require('../../models/System Management/Notification');
const User         = require('../../models/User Management/User');
const Company      = require('../../models/Company Management/Company');
const { notifyRetailer } = require('../../utils/pushHelper');

const OWNER_ROLES = ['Company Owner', 'Retailer'];

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

/**
 * Deliver one notification to a company: create the DB record for the owner
 * and fire a best-effort push. Returns true if delivered.
 */
async function deliverToCompany(companyId, { title, message, type }) {
  const owner = await User.findOne({ company_id: companyId, role: { $in: OWNER_ROLES } })
    .select('_id').lean();
  await Notification.create({
    company_id: companyId,
    user_id:    owner ? owner._id : null,
    type:       type || 'admin_message',
    title,
    message,
    is_read:    false,
  }).catch(() => {});
  if (owner) notifyRetailer(owner._id, { title, body: message, type: type || 'admin_message' });
  return !!owner;
}

/**
 * POST /api/notifications  (Super Admin)
 * Send a notification to a single company.
 * body: { company_id, title, message, type? }
 */
async function createNotification(req, res) {
  if (req.user.role !== 'Super Admin') return sendError(res, 'Access denied. Super Admin only.', 403);
  const { company_id, title, message, type } = req.body;
  if (!company_id) return sendError(res, 'company_id is required.');
  if (!title || !String(title).trim()) return sendError(res, 'title is required.');
  if (!message || !String(message).trim()) return sendError(res, 'message is required.');

  const company = await Company.findById(company_id).select('_id name').lean();
  if (!company) return sendError(res, 'Company not found.', 404);

  await deliverToCompany(company._id, { title: title.trim(), message: message.trim(), type });
  sendSuccess(res, { company: company.name }, 'Notification sent.', 201);
}

/**
 * POST /api/notifications/broadcast  (Super Admin)
 * Send a notification to every company on the platform (or only a status subset).
 * body: { title, message, type?, status? }  status default 'Approved'.
 */
async function broadcastNotification(req, res) {
  if (req.user.role !== 'Super Admin') return sendError(res, 'Access denied. Super Admin only.', 403);
  const { title, message, type, status } = req.body;
  if (!title || !String(title).trim()) return sendError(res, 'title is required.');
  if (!message || !String(message).trim()) return sendError(res, 'message is required.');

  const query = {};
  if (status && status !== 'All') query.status = status;
  const companies = await Company.find(query).select('_id').lean();

  let sent = 0;
  for (const c of companies) {
    await deliverToCompany(c._id, { title: title.trim(), message: message.trim(), type });
    sent += 1;
  }
  sendSuccess(res, { companies: sent }, `Broadcast sent to ${sent} companies.`, 201);
}

module.exports = {
  listNotifications, markNotificationRead, markAllNotificationsRead, deleteNotification,
  createNotification, broadcastNotification,
};
