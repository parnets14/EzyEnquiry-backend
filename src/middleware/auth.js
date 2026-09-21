const jwt          = require('jsonwebtoken')
const User         = require('../models/User Management/User')
const RetailerStaff = require('../models/Retailer Management/RetailerStaff')

/**
 * Verify JWT and attach req.user (ERP/staff) OR req.retailerStaff (retailer staff).
 *
 * Token shapes:
 *   Standard ERP/Staff  : { userId }
 *   Retailer Staff      : { retailerStaffId, companyId, app:'retailer_staff' }
 */
async function authenticate(req, res, next) {
  const header = req.headers['authorization']
  let token = null
  if (header && header.startsWith('Bearer ')) token = header.slice(7)
  else if (req.query && req.query.token) token = String(req.query.token)

  if (!token) {
    return res.status(401).json({ success: false, message: 'No token provided.' })
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    // ── Retailer Staff token ──────────────────────────────
    if (decoded.app === 'retailer_staff' && decoded.retailerStaffId) {
      const staff = await RetailerStaff.findById(decoded.retailerStaffId)
        .select('_id company_id name mobile email designation staff_app_access salary_breakdown is_active')
        .lean()

      if (!staff)          return res.status(401).json({ success: false, message: 'Staff member not found.' })
      if (!staff.is_active) return res.status(401).json({ success: false, message: 'Account deactivated.' })

      // Attach as req.retailerStaff so downstream can distinguish this from owner logins.
      // Also set req.user with minimal fields so shared middleware (requireCompany etc.) still works.
      req.retailerStaff = staff
      req.user = {
        _id:        staff._id,
        company_id: staff.company_id,
        name:       staff.name,
        mobile:     staff.mobile,
        email:      staff.email || '',
        role:       'RetailerStaff',   // synthetic role — not stored in User table
        is_active:  staff.is_active,
      }
      return next()
    }

    // ── Standard ERP / Staff App token ───────────────────
    const user = await User.findById(decoded.userId)
      .select('_id company_id name email mobile role is_active')
      .lean()

    if (!user)           return res.status(401).json({ success: false, message: 'User not found.' })
    if (!user.is_active) return res.status(401).json({ success: false, message: 'Account deactivated.' })

    req.user = user
    next()
  } catch (err) {
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

/**
 * Block data access in real time when the company is Suspended or inactive.
 * Super Admins bypass. Loads the company fresh on each request so an admin
 * suspension takes effect within seconds (no app restart needed).
 * Returns 403 with code 'ACCOUNT_SUSPENDED' so clients can show a clear screen.
 */
async function requireActiveCompany(req, res, next) {
  if (req.user?.role === 'Super Admin') return next()
  if (!req.user?.company_id) return next()   // requireCompany handles the missing-company case
  try {
    const Company = require('../models/Company Management/Company')
    const company = await Company.findById(req.user.company_id).select('status is_active suspend_reason').lean()
    if (company && (company.status === 'Suspended' || company.is_active === false)) {
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_SUSPENDED',
        message: company.suspend_reason
          ? `Your account is suspended. Reason: ${company.suspend_reason}`
          : 'Your account has been suspended. Please contact support.',
      })
    }
    return next()
  } catch (err) {
    return next(err)
  }
}

module.exports = { authenticate, authorize, requireCompany, requireActiveCompany }
