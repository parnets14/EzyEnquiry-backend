/**
 * auditLogger.js
 * Records mutating requests (POST/PUT/PATCH/DELETE) to the AuditLog collection
 * for audit / activity tracking (SOW §32).
 *
 * Non-blocking: it listens for the response `finish` event and writes the log
 * asynchronously AFTER the response is sent, so it never slows or breaks a request.
 * Only successful responses (2xx) are logged.
 *
 * Place AFTER `authenticate` in the middleware chain so req.user is available.
 */

const AuditLog = require('../models/System Management/AuditLog');
const { logger } = require('../utils/logger');

const ACTION_BY_METHOD = { POST: 'CREATE', PUT: 'UPDATE', PATCH: 'UPDATE', DELETE: 'DELETE' };

// Derive a human module name from the path, e.g. /api/products/123 → "products"
function moduleFromPath(p) {
  const cleaned = String(p || '').replace(/^\/api\//, '').replace(/^\//, '');
  const first = cleaned.split('/')[0] || '';
  return first.split('?')[0];
}

// Try to find an affected resource id from route params or common body keys.
function entityIdFrom(req) {
  if (req.params && req.params.id) return String(req.params.id);
  const body = req.body || {};
  return String(body._id || body.id || '');
}

function auditLogger(req, res, next) {
  const action = ACTION_BY_METHOD[req.method];
  if (!action) return next(); // only log mutations

  res.on('finish', () => {
    // Only log successful mutations
    if (res.statusCode < 200 || res.statusCode >= 300) return;

    const entry = {
      company_id:  req.user?.company_id || null,
      user_id:     req.user?._id || null,
      user_name:   req.user?.name || '',
      user_role:   req.user?.role || '',
      action,
      method:      req.method,
      module:      moduleFromPath(req.originalUrl || req.url),
      entity_id:   entityIdFrom(req),
      path:        (req.originalUrl || req.url || '').split('?')[0],
      status_code: res.statusCode,
      ip:          req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '',
      user_agent:  req.headers['user-agent'] || '',
    };

    AuditLog.create(entry).catch(err => logger.error(`[Audit] failed to write log: ${err.message}`));
  });

  next();
}

module.exports = { auditLogger };
