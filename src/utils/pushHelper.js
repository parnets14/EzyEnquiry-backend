/**
 * Push notification helper for marketplace events.
 * Sends push alongside database notifications (non-blocking, fails silently).
 */
const { sendPushToUser } = require('./firebase')

/**
 * Notify a retailer about their enquiry/order activity.
 * Called from marketplace controllers after creating a database notification.
 */
async function notifyRetailer(userId, { title, body, type, referenceId }) {
  if (!userId) return
  try {
    await sendPushToUser(userId, { title, body }, {
      type: type || '',
      reference_id: referenceId ? String(referenceId) : '',
    })
  } catch {
    // Non-blocking — push is best-effort
  }
}

/**
 * Notify a seller about retailer actions on their enquiry/order.
 * Looks up the seller's FCM token from their RetailerSession (wholesalers also use the same session model).
 * If not found, silently skips.
 */
async function notifySeller(userId, { title, body, type, referenceId }) {
  if (!userId) return
  try {
    await sendPushToUser(userId, { title, body }, {
      type: type || '',
      reference_id: referenceId ? String(referenceId) : '',
    })
  } catch {
    // Non-blocking
  }
}

module.exports = { notifyRetailer, notifySeller }
