const mongoose = require('mongoose');

/**
 * AuditLog — records mutating actions (create/update/delete) for traceability.
 * Written automatically by the auditLogger middleware after a successful
 * POST/PUT/PATCH/DELETE request.
 */
const auditLogSchema = new mongoose.Schema(
  {
    company_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null },
    user_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'User',    default: null },
    user_name:   { type: String, default: '' },
    user_role:   { type: String, default: '' },
    action:      { type: String, default: '' }, // CREATE | UPDATE | DELETE
    method:      { type: String, default: '' }, // POST | PUT | PATCH | DELETE
    module:      { type: String, default: '' }, // e.g. products, sales, orders
    entity_id:   { type: String, default: '' }, // affected resource id, if any
    path:        { type: String, default: '' }, // request path
    status_code: { type: Number, default: 0 },
    ip:          { type: String, default: '' },
    user_agent:  { type: String, default: '' },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false } }
);

auditLogSchema.index({ company_id: 1, created_at: -1 });
auditLogSchema.index({ user_id: 1, created_at: -1 });
auditLogSchema.index({ module: 1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
