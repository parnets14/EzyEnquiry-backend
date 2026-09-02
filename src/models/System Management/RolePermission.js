const mongoose = require('mongoose')

/**
 * RolePermission — per-company, per-role module access overrides.
 * `permissions` stores schema-v2 action maps:
 *   { products: { view: true, create: false, edit: false, delete: false } }
 * Legacy flat booleans remain readable through config/permissions normalisation.
 */
const rolePermissionSchema = new mongoose.Schema(
  {
    company_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    role:       { type: String, required: true, trim: true },
    schema_version: { type: Number, default: 2 },
    permissions: { type: Object, default: {} }, // { moduleKey: { actionKey: bool } }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
)

rolePermissionSchema.index({ company_id: 1, role: 1 }, { unique: true })

module.exports = mongoose.model('RolePermission', rolePermissionSchema)
