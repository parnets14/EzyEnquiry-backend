/**
 * Firebase Admin SDK — Push Notification Sender
 *
 * Setup:
 * 1. Go to Firebase Console → Project Settings → Service Accounts
 * 2. Click "Generate New Private Key" → Download JSON
 * 3. Save it as: EzyEnquiry-backend/firebase-service-account.json
 * 4. Add to .env: FIREBASE_ENABLED=true
 *
 * OR set individual env vars:
 *   FIREBASE_PROJECT_ID=your-project-id
 *   FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@your-project.iam.gserviceaccount.com
 *   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
 */

const path = require('path')
const { logger } = require('./logger')

let messagingClient = null
let isInitialized = false

function initFirebase() {
  if (isInitialized) return !!messagingClient

  if (process.env.FIREBASE_ENABLED !== 'true') {
    logger.info('[Firebase] Disabled (FIREBASE_ENABLED != true)')
    isInitialized = true
    return false
  }

  try {
    const { cert, initializeApp } = require('firebase-admin/app')
    const { getMessaging } = require('firebase-admin/messaging')

    // Try service account file first
    const serviceAccountPath = path.resolve(__dirname, '../../firebase-service-account.json')
    let credential

    try {
      const serviceAccount = require(serviceAccountPath)
      credential = cert(serviceAccount)
      logger.info('[Firebase] Using service account file')
    } catch (serviceAccountError) {
      logger.warn(`[Firebase] Service account unavailable: ${serviceAccountError.message}`)
      // Fall back to env vars
      if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
        credential = cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        })
        logger.info('[Firebase] Using environment variables')
      } else {
        logger.warn('[Firebase] No credentials found. Push notifications disabled.')
        isInitialized = true
        return false
      }
    }

    initializeApp({ credential })
    messagingClient = getMessaging()
    isInitialized = true
    logger.info('[Firebase] ✓ Initialized successfully')
    return true
  } catch (error) {
    logger.error('[Firebase] Initialization failed:', error.message)
    isInitialized = true
    return false
  }
}

/**
 * Send a push notification to a single device token.
 * @param {string} fcmToken - Device FCM token
 * @param {object} notification - { title, body }
 * @param {object} data - Custom data payload (all values must be strings)
 * @returns {Promise<boolean>} - true if sent, false if failed/disabled
 */
async function sendPush(fcmToken, notification, data = {}) {
  if (!initFirebase() || !messagingClient) return false
  if (!fcmToken) return false

  try {
    // Ensure all data values are strings (FCM requirement)
    const stringData = {}
    for (const [key, value] of Object.entries(data)) {
      stringData[key] = String(value || '')
    }

    const message = {
      token: fcmToken,
      notification: {
        title: notification.title || '',
        body: notification.body || '',
      },
      data: stringData,
      android: {
        priority: 'high',
        notification: {
          channelId: 'ezyenquiry_default',
          sound: 'default',
          priority: 'high',
        },
      },
    }

    const response = await messagingClient.send(message)
    logger.info(`[Firebase] Push sent: ${notification.title} → ${fcmToken.substring(0, 15)}...`)
    return true
  } catch (error) {
    const invalidToken = error.code === 'messaging/registration-token-not-registered'
      || error.code === 'messaging/invalid-registration-token'

    if (invalidToken) {
      logger.warn(`[Firebase] Invalid token: ${fcmToken.substring(0, 15)}... — deactivating`)
      try {
        const RetailerSession = require('../models/Retailer Management/RetailerSession')
        await RetailerSession.updateMany(
          { fcm_token: fcmToken },
          { $set: { fcm_token: '', is_active: false } }
        )
      } catch (cleanupError) {
        logger.error(`[Firebase] Invalid token cleanup failed: ${cleanupError.message}`)
      }
    } else {
      logger.error(`[Firebase] Send failed: ${error.message}`)
    }
    return false
  }
}

/**
 * Send push to multiple tokens (e.g. all devices of a user).
 * @param {string[]} tokens - Array of FCM tokens
 * @param {object} notification - { title, body }
 * @param {object} data - Custom data payload
 * @returns {Promise<{success: number, failure: number, invalidTokens: string[]}>}
 */
async function sendPushMultiple(tokens, notification, data = {}) {
  if (!initFirebase() || !messagingClient) return { success: 0, failure: 0, invalidTokens: [] }
  if (!tokens || tokens.length === 0) return { success: 0, failure: 0, invalidTokens: [] }

  const stringData = {}
  for (const [key, value] of Object.entries(data)) {
    stringData[key] = String(value || '')
  }

  const message = {
    notification: {
      title: notification.title || '',
      body: notification.body || '',
    },
    data: stringData,
    android: {
      priority: 'high',
      notification: {
        channelId: 'ezyenquiry_default',
        sound: 'default',
      },
    },
    tokens,
  }

  try {
    const response = await messagingClient.sendEachForMulticast(message)
    const invalidTokens = []
    response.responses.forEach((resp, idx) => {
      if (!resp.success && (
        resp.error?.code === 'messaging/registration-token-not-registered' ||
        resp.error?.code === 'messaging/invalid-registration-token'
      )) {
        invalidTokens.push(tokens[idx])
      }
    })
    return { success: response.successCount, failure: response.failureCount, invalidTokens }
  } catch (error) {
    logger.error(`[Firebase] Multicast failed: ${error.message}`)
    return { success: 0, failure: tokens.length, invalidTokens: [] }
  }
}

/**
 * Send push to a retailer by user ID (looks up their stored FCM token).
 */
async function sendPushToUser(userId, notification, data = {}) {
  if (!initFirebase() || !messagingClient) return false

  const RetailerSession = require('../models/Retailer Management/RetailerSession')
  const session = await RetailerSession.findOne({ user_id: userId, is_active: true, fcm_token: { $ne: '' } }).lean()
  if (!session?.fcm_token) return false

  return sendPush(session.fcm_token, notification, data)
}

module.exports = {
  initFirebase,
  sendPush,
  sendPushMultiple,
  sendPushToUser,
}
