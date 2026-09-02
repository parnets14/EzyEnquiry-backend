const { sendSuccess, sendError } = require('../../utils/helpers')
const RolePermission = require('../../models/System Management/RolePermission')
const {
  MODULE_CATALOG, ROLES, defaultsForRole, effectivePermissions,
} = require('../../config/permissions')

const LOCKED_ROLES = ['Super Admin']

/** GET /api/role-permissions — full action matrix for administrators. */
async function listRolePermissions(req, res) {
  const companyId = req.user.company_id
  const docs = companyId ? await RolePermission.find({ company_id: companyId }).lean() : []
  const byRole = Object.fromEntries(docs.map(doc => [doc.role, doc]))

  const roles = ROLES.map(role => ({
    role,
    locked: LOCKED_ROLES.includes(role),
    permissions: effectivePermissions(role, byRole[role]?.permissions),
  }))

  sendSuccess(res, { schema_version: 2, modules: MODULE_CATALOG, roles })
}

/** GET /api/role-permissions/me — effective actions for current user. */
async function myPermissions(req, res) {
  const { role, company_id: companyId } = req.user
  const doc = companyId
    ? await RolePermission.findOne({ company_id: companyId, role }).lean()
    : null

  sendSuccess(res, {
    schema_version: 2,
    role,
    permissions: effectivePermissions(role, doc?.permissions),
    modules: MODULE_CATALOG,
  })
}

/**
 * PUT /api/role-permissions/:role
 * Body: { permissions: { moduleKey: { actionKey: boolean } } }
 */
async function updateRolePermissions(req, res) {
  const role = req.params.role
  const companyId = req.user.company_id

  if (!ROLES.includes(role)) return sendError(res, `Unknown role: ${role}`, 400)
  if (LOCKED_ROLES.includes(role)) return sendError(res, 'Super Admin permissions cannot be modified.', 403)
  if (!companyId) return sendError(res, 'No company associated with this account.', 400)

  const incoming = req.body?.permissions
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return sendError(res, 'permissions object is required.', 400)
  }

  // Strictly retain known modules/actions and coerce only explicit booleans.
  const clean = defaultsForRole(role)
  for (const module of MODULE_CATALOG) {
    const moduleInput = incoming[module.key]
    if (typeof moduleInput === 'boolean') {
      // Accept old clients during rollout.
      for (const item of module.actions) clean[module.key][item.key] = moduleInput
      continue
    }
    if (!moduleInput || typeof moduleInput !== 'object' || Array.isArray(moduleInput)) continue
    for (const item of module.actions) {
      if (typeof moduleInput[item.key] === 'boolean') clean[module.key][item.key] = moduleInput[item.key]
    }
  }

  const doc = await RolePermission.findOneAndUpdate(
    { company_id: companyId, role },
    { $set: { schema_version: 2, permissions: clean } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean()

  sendSuccess(res, {
    schema_version: 2,
    role,
    permissions: effectivePermissions(role, doc.permissions),
  }, 'Permissions updated.')
}

module.exports = { listRolePermissions, myPermissions, updateRolePermissions }
