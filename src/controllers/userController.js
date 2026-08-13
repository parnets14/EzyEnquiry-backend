const bcrypt = require('bcryptjs')
const { sendSuccess, sendError, paginate } = require('../utils/helpers')
const { User } = require('../models')

// Must match the enum in User model schema
const VALID_ROLES = ['Super Admin', 'Company Owner', 'Manager', 'Accountant', 'Sales Executive', 'Warehouse Staff', 'Retailer', 'Wholesaler']

/** GET /api/users */
async function listUsers(req, res) {
  const { page = 1, limit = 20, role, is_active } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)

  const total = await User.count(req.user.company_id, { role, is_active })
  const users = await User.findAll(req.user.company_id, { role, is_active, limit: parseInt(limit), offset })

  sendSuccess(res, { users, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

/** GET /api/users/:id */
async function getUser(req, res) {
  const user = await User.findById(req.params.id, req.user.company_id)
  if (!user) return sendError(res, 'User not found.', 404)
  sendSuccess(res, user)
}

/** POST /api/users */
async function createUser(req, res) {
  const { name, email, mobile, password, role } = req.body
  if (!name || !email || !mobile || !password) return sendError(res, 'Name, email, mobile and password are required.')
  if (!VALID_ROLES.includes(role)) return sendError(res, `Invalid role. Valid: ${VALID_ROLES.join(', ')}`)

  const emailExists = await User.checkEmailExists(email)
  const mobileExists = await User.checkMobileExists(mobile)
  if (emailExists || mobileExists) return sendError(res, 'User with this email or mobile already exists.', 409)

  const password_hash = await bcrypt.hash(password, 12)
  const user = await User.create({
    company_id: req.user.company_id,
    name,
    email,
    mobile,
    password_hash,
    role,
  })

  sendSuccess(res, user, 'User created.', 201)
}

/** PUT /api/users/:id */
async function updateUser(req, res) {
  const { name, mobile, role, is_active } = req.body
  const user = await User.update(req.params.id, req.user.company_id, { name, mobile, role, is_active })
  if (!user) return sendError(res, 'User not found.', 404)
  sendSuccess(res, user, 'User updated.')
}

/** DELETE /api/users/:id */
async function deleteUser(req, res) {
  if (req.params.id === String(req.user._id)) return sendError(res, 'Cannot delete your own account.')
  const deleted = await User.delete(req.params.id, req.user.company_id)
  if (!deleted) return sendError(res, 'User not found.', 404)
  sendSuccess(res, null, 'User deleted.')
}

/** PATCH /api/users/:id/reset-password  — Admin resets a user's password */
async function resetPassword(req, res) {
  const { new_password } = req.body
  if (!new_password || new_password.length < 8) return sendError(res, 'Password must be at least 8 characters.')
  const hash = await bcrypt.hash(new_password, 12)
  const user = await User.updatePassword(req.params.id, hash)
  if (!user) return sendError(res, 'User not found.', 404)
  sendSuccess(res, null, 'Password reset successfully.')
}

module.exports = { listUsers, getUser, createUser, updateUser, deleteUser, resetPassword }
