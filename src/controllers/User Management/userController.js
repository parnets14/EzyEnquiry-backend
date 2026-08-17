const bcrypt = require('bcryptjs')
const { sendSuccess, sendError, paginate } = require('../../utils/helpers')
const User = require('../../models/User Management/User')

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

/** GET /api/users/:id */
async function getUser(req, res) {
  const user = await User.findOne({ _id: req.params.id, company_id: req.user.company_id }).select('-password_hash').lean()
  if (!user) return sendError(res, 'User not found.', 404)
  sendSuccess(res, user)
}

/** POST /api/users */
async function createUser(req, res) {
  const { name, email, mobile, password, role } = req.body
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

  const password_hash = await bcrypt.hash(password, 12)
  const user = await User.create({ company_id: req.user.company_id, name, email, mobile, password_hash, role })
  const { password_hash: _, ...safe } = user.toObject()
  sendSuccess(res, safe, 'User created.', 201)
}

/** PUT /api/users/:id */
async function updateUser(req, res) {
  const { name, mobile, role, is_active } = req.body
  const update = {}
  if (name      !== undefined) update.name      = name
  if (mobile    !== undefined) update.mobile    = mobile
  if (role      !== undefined) update.role      = role
  if (is_active !== undefined) update.is_active = is_active

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

module.exports = { listUsers, getUser, createUser, updateUser, deleteUser, resetPassword }
