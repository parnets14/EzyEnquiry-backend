const jwt  = require('jsonwebtoken')
const User = require('../models/User Management/User')

/**
 * Verify JWT and attach req.user
 */
async function authenticate(req, res, next) {
  const header = req.headers['authorization']
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'No token provided.' })
  }

  const token = header.slice(7)
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    // Use UserModel (Mongoose model) directly so .select() and .lean() work
    const user = await User.findById(decoded.userId)
      .select('_id company_id name email mobile role is_active')
      .lean()

    if (!user)           return res.status(401).json({ success: false, message: 'User not found.' })
    if (!user.is_active) return res.status(401).json({ success: false, message: 'Account deactivated.' })

    req.user = user
    next()
  } catch (err) {
    // JWT errors → 401, never 500
    if (
      err.name === 'JsonWebTokenError' ||
      err.name === 'TokenExpiredError' ||
      err.name === 'NotBeforeError'
    ) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token.' })
    }
    next(err)
  }
}

/**
 * Role-based access guard
 * Usage: authorize('Super Admin', 'Admin')
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ success: false, message: 'Access denied. Insufficient permissions.' })
    }
    next()
  }
}

/**
 * Ensure the authenticated user belongs to a company.
 * Super Admins are exempt — they operate across all companies.
 */
function requireCompany(req, res, next) {
  if (req.user?.role === 'Super Admin') return next()
  if (!req.user?.company_id) {
    return res.status(400).json({ success: false, message: 'No company associated with this account.' })
  }
  next()
}

module.exports = { authenticate, authorize, requireCompany }
