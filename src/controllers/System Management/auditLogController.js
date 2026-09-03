const { sendSuccess, paginate } = require('../../utils/helpers');
const AuditLog = require('../../models/System Management/AuditLog');

/** GET /api/audit-logs
 * Query: module, action, user_id, from_date, to_date, page, limit
 * Super Admin sees all; Company Owner sees only their company.
 */
async function listAuditLogs(req, res) {
  const { module, action, user_id, from_date, to_date, page = 1, limit = 30 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = {};
  if (req.user.role !== 'Super Admin') query.company_id = req.user.company_id;
  if (module)  query.module = module;
  if (action)  query.action = action;
  if (user_id) query.user_id = user_id;
  if (from_date) query.created_at = { ...query.created_at, $gte: new Date(from_date) };
  if (to_date)   query.created_at = { ...query.created_at, $lte: new Date(to_date + 'T23:59:59') };

  const [total, logs] = await Promise.all([
    AuditLog.countDocuments(query),
    AuditLog.find(query).sort({ created_at: -1 }).skip(offset).limit(parseInt(limit)).lean(),
  ]);

  sendSuccess(res, { logs, pagination: paginate(total, parseInt(page), parseInt(limit)) });
}

module.exports = { listAuditLogs };
