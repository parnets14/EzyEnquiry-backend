const bcrypt = require('bcryptjs')
const { sendSuccess, sendError, paginate } = require('../../utils/helpers')
const User = require('../../models/User Management/User')
const Company = require('../../models/Company Management/Company')
const RolePermission = require('../../models/System Management/RolePermission')
const { MODULE_CATALOG, effectivePermissions } = require('../../config/permissions')

const VALID_ROLES = ['Super Admin', 'Company Owner', 'Manager', 'Accountant', 'Sales Executive', 'Warehouse Staff', 'Retailer', 'Wholesaler']

/** GET /api/users */
async function listUsers(req, res) {
  const { page = 1, limit = 20, role, is_active } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)

  const query = { company_id: req.user.company_id }
  if (role)                    query.role      = role
  if (is_active !== undefined) query.is_active = is_active !== 'false'

  const [total, users] = await Promise.all([
    User.countDocuments(query),
    User.find(query).select('-password_hash').sort({ created_at: -1 }).skip(offset).limit(parseInt(limit)).lean(),
  ])

  sendSuccess(res, { users, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

/** GET /api/users/access-candidates — Admin-only registered people for page access assignment. */
async function listAccessCandidates(req, res) {
  const users = await User.find({
    company_id: req.user.company_id,
    role: { $ne: 'Super Admin' },
  }).select('-password_hash').sort({ name: 1 }).lean()

  const companyIds = [...new Set(users.map(user => String(user.company_id))) ]
  const roleDocs = companyIds.length
    ? await RolePermission.find({ company_id: { $in: companyIds } }).lean()
    : []
  const companies = companyIds.length
    ? await Company.find({ _id: { $in: companyIds } }).select('name company_code').lean()
    : []
  const companyNames = new Map(companies.map(company => [String(company._id), company.name]))
  const permissionsByCompanyRole = new Map(
    roleDocs.map(doc => [`${doc.company_id}:${doc.role}`, doc.permissions]),
  )

  const people = users.map(user => {
    const rolePermissions = permissionsByCompanyRole.get(`${user.company_id}:${user.role}`)
    const hasUserOverrides = user.permissions && typeof user.permissions === 'object'
      && !Array.isArray(user.permissions) && Object.keys(user.permissions).length > 0
    return {
      ...user,
      company_name: companyNames.get(String(user.company_id)) || '',
      access_permissions: effectivePermissions(
        user.role,
        hasUserOverrides ? user.permissions : rolePermissions,
      ),
    }
  })

  sendSuccess(res, { users: people, pages: MODULE_CATALOG.map(({ key, label, category }) => ({ key, label, category })) })
}

/** PATCH /api/users/:id/access — Admin-only page access assignment for one registered person. */
async function updateUserAccess(req, res) {
  const incoming = req.body?.permissions
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return sendError(res, 'permissions object is required.', 400)
  }

  const user = await User.findOne({
    _id: req.params.id,
    company_id: req.user.company_id,
    role: { $ne: 'Super Admin' },
  }).select('company_id role permissions').lean()
  if (!user) return sendError(res, 'Registered person not found.', 404)

  const rolePermission = await RolePermission.findOne({ company_id: user.company_id, role: user.role }).lean()
  const base = effectivePermissions(user.role, user.permissions || rolePermission?.permissions)
  const clean = {}
  for (const module of MODULE_CATALOG) {
    clean[module.key] = { ...base[module.key] }
    const moduleInput = incoming[module.key]
    if (typeof moduleInput === 'boolean') {
      for (const action of module.actions) clean[module.key][action.key] = moduleInput
    } else if (moduleInput && typeof moduleInput === 'object' && !Array.isArray(moduleInput)) {
      for (const action of module.actions) {
        if (typeof moduleInput[action.key] === 'boolean') {
          clean[module.key][action.key] = moduleInput[action.key]
        }
      }
    }
  }

  const updated = await User.findOneAndUpdate(
    { _id: user._id, company_id: req.user.company_id },
    { $set: { permissions: clean } },
    { new: true },
  ).select('-password_hash').lean()
  sendSuccess(res, updated, 'Page access updated.')
}

/** GET /api/users/:id */
async function getUser(req, res) {
  const user = await User.findOne({ _id: req.params.id, company_id: req.user.company_id }).select('-password_hash').lean()
  if (!user) return sendError(res, 'User not found.', 404)
  sendSuccess(res, user)
}

/** POST /api/users */
async function createUser(req, res) {
  const { name, email, mobile, password, role, permissions } = req.body
  if (!name || !email || !mobile || !password)
    return sendError(res, 'Name, email, mobile and password are required.')
  if (!VALID_ROLES.includes(role))
    return sendError(res, `Invalid role. Valid roles: ${VALID_ROLES.join(', ')}`)

  const [emailExists, mobileExists] = await Promise.all([
    User.findOne({ email: email.toLowerCase() }).select('_id').lean(),
    User.findOne({ mobile }).select('_id').lean(),
  ])
  if (emailExists || mobileExists)
    return sendError(res, 'User with this email or mobile already exists.', 409)

  // Optional per-user permission overrides. Accept a plain object only.
  const permsOverride = (permissions && typeof permissions === 'object' && !Array.isArray(permissions))
    ? permissions
    : null

  const password_hash = await bcrypt.hash(password, 12)
  const user = await User.create({
    company_id: req.user.company_id, name, email, mobile, password_hash, role,
    permissions: permsOverride,
  })
  const { password_hash: _, ...safe } = user.toObject()
  sendSuccess(res, safe, 'User created.', 201)
}

/** PUT /api/users/:id */
async function updateUser(req, res) {
  const { name, mobile, role, is_active, permissions } = req.body
  const update = {}
  if (name      !== undefined) update.name      = name
  if (mobile    !== undefined) update.mobile    = mobile
  if (role      !== undefined) update.role      = role
  if (is_active !== undefined) update.is_active = is_active
  // Per-user permission overrides. Pass null to clear (revert to role defaults).
  if (permissions !== undefined) {
    update.permissions = (permissions && typeof permissions === 'object' && !Array.isArray(permissions))
      ? permissions
      : null
  }

  const user = await User.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    update,
    { new: true }
  ).select('-password_hash').lean()
  if (!user) return sendError(res, 'User not found.', 404)
  sendSuccess(res, user, 'User updated.')
}

/** DELETE /api/users/:id */
async function deleteUser(req, res) {
  if (req.params.id === String(req.user._id))
    return sendError(res, 'Cannot delete your own account.', 403)
  const result = await User.deleteOne({ _id: req.params.id, company_id: req.user.company_id })
  if (result.deletedCount === 0) return sendError(res, 'User not found.', 404)
  sendSuccess(res, null, 'User deleted.')
}

/** PATCH /api/users/:id/reset-password */
async function resetPassword(req, res) {
  const { new_password } = req.body
  if (!new_password || new_password.length < 8)
    return sendError(res, 'Password must be at least 8 characters.')
  const password_hash = await bcrypt.hash(new_password, 12)
  const user = await User.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    { password_hash },
    { new: true }
  ).lean()
  if (!user) return sendError(res, 'User not found.', 404)
  sendSuccess(res, null, 'Password reset successfully.')
}

module.exports = { listUsers, listAccessCandidates, updateUserAccess, getUser, createUser, updateUser, deleteUser, resetPassword }
