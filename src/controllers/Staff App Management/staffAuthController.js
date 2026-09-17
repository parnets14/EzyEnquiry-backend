const jwt = require('jsonwebtoken')

const Employee = require('../../models/HR Management/Employee')
const User     = require('../../models/User Management/User')
const Company  = require('../../models/Company Management/Company')
const { generateOtp, storeOtp, verifyOtp } = require('../../utils/otp')
const { sendSuccess, sendError }           = require('../../utils/helpers')

const STAFF_OTP_PURPOSE = 'staff_login'

// Valid staff roles (must match config/permissions.js ROLE_MODULES keys).
const STAFF_ROLES = ['Manager', 'Accountant', 'Sales Executive', 'Warehouse Staff']

/**
 * Map an employee's designation/department to one of the RBAC staff roles.
 * Falls back to 'Sales Executive' when nothing matches.
 */
function roleFromDesignation(employee) {
  const text = `${employee.designation || ''} ${employee.department || ''}`.toLowerCase()

  // Exact role name match first (e.g. designation literally "Manager").
  const exact = STAFF_ROLES.find(r => text.includes(r.toLowerCase()))
  if (exact) return exact

  // Keyword heuristics.
  if (/\b(manager|admin|supervisor|owner|head)\b/.test(text)) return 'Manager'
  if (/\b(account|accountant|finance|cashier|billing)\b/.test(text)) return 'Accountant'
  if (/\b(warehouse|store|stock|inventory|dispatch|picker|packer|godown)\b/.test(text)) return 'Warehouse Staff'
  if (/\b(sales|executive|marketing|bde|telecaller|crm)\b/.test(text)) return 'Sales Executive'

  return 'Sales Executive'
}

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  })
}

/** Normalise any input to the last 10 digits of a mobile number. */
function normaliseMobile(value) {
  return String(value || '').replace(/\D/g, '').slice(-10)
}

/** Find an active employee whose mobile matches (stored numbers may have +91 etc.). */
async function findActiveEmployeeByMobile(mobile) {
  const digits = normaliseMobile(mobile)
  if (digits.length !== 10) return null

  // Match the last 10 digits regardless of how the number was stored.
  const employees = await Employee.find({
    is_active: true,
    mobile: { $regex: `${digits}$` },
  })
    .sort({ updated_at: -1 })
    .lean()

  return employees.find(emp => normaliseMobile(emp.mobile) === digits) || null
}

/**
 * Find an active staff User (added from admin panel) whose mobile matches.
 * Returns a synthetic "employee-like" object so the rest of the flow works.
 */
async function findActiveUserByMobile(mobile) {
  const digits = normaliseMobile(mobile)
  if (digits.length !== 10) return null

  const user = await User.findOne({
    mobile: { $regex: `${digits}$` },
    is_active: true,
    role: { $in: STAFF_ROLES },
  }).lean()

  if (!user) return null
  if (normaliseMobile(user.mobile) !== digits) return null

  // Return a shape that looks enough like an Employee for the rest of the code.
  return {
    _id:        user._id,
    user_id:    user._id,
    name:       user.name,
    email:      user.email || '',
    mobile:     digits,
    company_id: user.company_id,
    designation: user.role,  // use role as designation
    department:  '',
    branch:      '',
    is_active:   true,
    _isUserRecord: true,     // flag so ensureStaffUser skips re-creating
  }
}

/**
 * Ensure a login-capable User exists for this employee so the issued token
 * works with the shared `authenticate` middleware and company-scoped routes.
 */
async function ensureStaffUser(employee) {
  // If the "employee" came from the User table directly, just fetch the user.
  if (employee._isUserRecord) {
    const user = await User.findById(employee._id).lean()
    if (user) return user
  }

  const desiredRole = roleFromDesignation(employee)

  if (employee.user_id) {
    const existing = await User.findById(employee.user_id).lean()
    if (existing) {
      // Keep the staff user's role in sync with their current designation.
      if (existing.role !== desiredRole && STAFF_ROLES.includes(desiredRole)) {
        await User.findByIdAndUpdate(existing._id, { role: desiredRole })
        existing.role = desiredRole
      }
      return existing
    }
  }

  const digits = normaliseMobile(employee.mobile)

  // Reuse a User that already carries this mobile within the same company.
  let user = await User.findOne({
    company_id: employee.company_id,
    mobile: { $regex: `${digits}$` },
  }).lean()

  if (user) {
    // Existing user found by mobile — sync role to designation.
    if (user.role !== desiredRole && STAFF_ROLES.includes(desiredRole)) {
      await User.findByIdAndUpdate(user._id, { role: desiredRole })
      user.role = desiredRole
    }
  }

  if (!user) {
    const placeholderEmail =
      employee.email && employee.email.includes('@')
        ? employee.email.toLowerCase().trim()
        : `staff.${digits}@ezyenquiry.local`

    // Avoid unique-email collisions if the address is already taken.
    const emailTaken = await User.findOne({ email: placeholderEmail }).lean()
    const finalEmail = emailTaken
      ? `staff.${digits}.${Date.now()}@ezyenquiry.local`
      : placeholderEmail

    const created = await User.create({
      company_id: employee.company_id,
      name:       employee.name,
      email:      finalEmail,
      mobile:     digits,
      role:       desiredRole,
      is_active:  true,
    })
    user = created.toObject()
  }

  // Link the User back to the Employee for next time.
  if (!employee.user_id || String(employee.user_id) !== String(user._id)) {
    await Employee.findByIdAndUpdate(employee._id, { user_id: user._id })
  }

  return user
}

/** POST /api/auth/staff/send-otp — body: { mobile } */
async function staffSendOtp(req, res) {
  const digits = normaliseMobile(req.body.mobile)
  if (digits.length !== 10) {
    return sendError(res, 'Enter a valid 10-digit mobile number.')
  }

  // Check Employee table first, then fall back to User table (staff added from admin panel)
  let employee = await findActiveEmployeeByMobile(digits)
  if (!employee) employee = await findActiveUserByMobile(digits)

  if (!employee) {
    return sendError(
      res,
      'This mobile is not registered as an active staff member. Contact your Admin.',
      404,
    )
  }

  const otp = generateOtp()
  await storeOtp(digits, otp, STAFF_OTP_PURPOSE, 'mobile')

  console.log(`\n========================================`)
  console.log(`  STAFF OTP for ${digits}: ${otp}  [${STAFF_OTP_PURPOSE}]`)
  console.log(`========================================\n`)

  // Always return OTP in response (SMS not configured).
  const responseData = { sent: true, name: employee.name, otp }
  sendSuccess(res, responseData, 'OTP sent to your registered mobile.')
}

/** POST /api/auth/staff/verify-otp — body: { mobile, otp } */
async function staffVerifyOtp(req, res) {
  const digits = normaliseMobile(req.body.mobile)
  const otpVal = String(req.body.otp || '').trim()
  if (digits.length !== 10 || !otpVal) {
    return sendError(res, 'Mobile number and OTP are required.')
  }

  // Check Employee table first, then fall back to User table
  let employee = await findActiveEmployeeByMobile(digits)
  if (!employee) employee = await findActiveUserByMobile(digits)

  if (!employee) {
    return sendError(
      res,
      'This mobile is not registered as an active staff member. Contact your Admin.',
      404,
    )
  }

  const result = await verifyOtp(digits, otpVal, STAFF_OTP_PURPOSE)
  if (!result.valid) {
    return sendError(res, result.reason, 400)
  }

  const user = await ensureStaffUser(employee)
  await User.findByIdAndUpdate(user._id, { last_login: new Date() })

  const company = employee.company_id
    ? await Company.findById(employee.company_id).select('name status').lean()
    : null

  const token = signToken(user._id)
  const staff = {
    id:           employee._isUserRecord ? user._id : employee._id,
    userId:       user._id,
    empCode:      employee.emp_code || '',
    name:         employee.name,
    mobile:       normaliseMobile(employee.mobile),
    email:        employee.email || user.email || '',
    department:   employee.department || '',
    designation:  employee.designation || user.role || '',
    branch:       employee.branch || '',
    joinDate:     employee.join_date || null,
    role:         user.role || '',
    status:       employee.is_active ? 'ACTIVE' : 'INACTIVE',
    companyId:    employee.company_id,
    companyName:  company?.name || '',
  }

  sendSuccess(res, { token, staff }, 'OTP verified. Login successful.')
}

module.exports = { staffSendOtp, staffVerifyOtp }
