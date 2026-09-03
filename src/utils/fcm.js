/**
 * src/utils/fcm.js
 * Firebase Cloud Messaging utility
 * Sends push notifications to the Wholesaler App via FCM.
 *
 * Setup:
 *  1. Go to Firebase Console → Project Settings → Service Accounts
 *  2. Click "Generate new private key" → download the JSON
 *  3. Set these env vars from that JSON file (see .env.example)
 */

const admin = require('firebase-admin')

let messaging = null   // lazily initialised

function getMessaging() {
  if (messaging) return messaging

  const projectId   = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY

  if (!projectId || !clientEmail || !privateKey) {
    console.warn('[FCM] Firebase credentials not set in .env — push notifications disabled.')
    return null
  }

  try {
    // Avoid re-initialising if another module already did it
    const app = admin.apps.length
      ? admin.apps[0]
      : admin.initializeApp({
          credential: admin.credential.cert({
            projectId,
            clientEmail,
            // env vars escape \n as \\n — fix it
            privateKey: privateKey.replace(/\\n/g, '\n'),
          }),
        })

    messaging = app.messaging()
    console.log('[FCM] Firebase Admin initialised successfully.')
  } catch (err) {
    console.error('[FCM] Failed to initialise Firebase Admin:', err.message)
    return null
  }

  return messaging
}

/**
 * Send a push notification to a single FCM token.
 *
 * @param {string} fcmToken   - Device FCM registration token
 * @param {string} title      - Notification title
 * @param {string} body       - Notification body text
 * @param {object} data       - Optional key-value payload (all values must be strings)
 * @returns {Promise<boolean>} - true on success, false on failure
 */
async function sendPushNotification(fcmToken, title, body, data = {}) {
  const msg = getMessaging()
  if (!msg) return false  // Firebase not configured — skip silently

  if (!fcmToken || typeof fcmToken !== 'string' || fcmToken.trim() === '') {
    console.warn('[FCM] sendPushNotification called with empty token — skipping.')
    return false
  }

  try {
    const message = {
      token: fcmToken.trim(),
      notification: { title, body },
      // data payload — all values must be strings
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: {
        priority: 'high',
        notification: {
          sound:       'default',
          channelId:   'approval_channel',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      apns: {
        payload: {
          aps: { sound: 'default', badge: 1 },
        },
      },
    }

    const response = await msg.send(message)
    console.log(`[FCM] Push sent → token=${fcmToken.slice(0, 20)}… msgId=${response}`)
    return true
  } catch (err) {
    // Token expired / unregistered — log but don't crash
    console.error(`[FCM] Push failed → ${err.message}`)
    return false
  }
}

/**
 * Send push to ALL active sessions of a user (multi-device support).
 *
 * @param {string} userId        - MongoDB User _id
 * @param {string} title
 * @param {string} body
 * @param {object} data
 */
async function sendPushToUser(userId, title, body, data = {}) {
  const WholesalerSession = require('../models/Wholesaler Management/WholesalerSession')

  const sessions = await WholesalerSession.find({
    user_id:   userId,
    is_active: true,
    fcm_token: { $ne: '' },
  }).lean()

  if (!sessions.length) {
    console.log(`[FCM] No active sessions for user=${userId} — skipping push.`)
    return
  }

  const results = await Promise.allSettled(
    sessions.map(s => sendPushNotification(s.fcm_token, title, body, data))
  )

  const ok = results.filter(r => r.value === true).length
  console.log(`[FCM] sendPushToUser user=${userId} → ${ok}/${sessions.length} sent`)
}

module.exports = { sendPushNotification, sendPushToUser }
