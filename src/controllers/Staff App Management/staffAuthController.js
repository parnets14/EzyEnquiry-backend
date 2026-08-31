const jwt = require('jsonwebtoken')

const Employee = require('../../models/HR Management/Employee')
const User     = require('../../models/User Management/User')
const Company  = require('../../models/Company Management/Company')
const { generateOtp, storeOtp, verifyOtp } = require('../../utils/otp')
const { sendSuccess, sendError }           = require('../../utils/helpers')

const STAFF_OTP_PURPOSE = 'staff_login'

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
 * Ensure a login-capable User exists for this employee so the issued token
 * works with the shared `authenticate` middleware and company-scoped routes.
 */
async function ensureStaffUser(employee) {
  if (employee.user_id) {
    const existing = await User.findById(employee.user_id).lean()
    if (existing) return existing
  }

  const digits = normaliseMobile(employee.mobile)

  // Reuse a User that already carries this mobile within the same company.
  let user = await User.findOne({
    company_id: employee.company_id,
    mobile: { $regex: `${digits}$` },
  }).lean()

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
      role:       'Sales Executive',
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

  const employee = await findActiveEmployeeByMobile(digits)
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

  const devReturn =
    process.env.OTP_DEV_RETURN === 'true' && process.env.NODE_ENV !== 'production'
  const responseData = { sent: true, name: employee.name }
  if (devReturn) responseData.otp = otp

  sendSuccess(res, responseData, 'OTP sent to your registered mobile.')
}

/** POST /api/auth/staff/verify-otp — body: { mobile, otp } */
async function staffVerifyOtp(req, res) {
  const digits = normaliseMobile(req.body.mobile)
  const otpVal = String(req.body.otp || '').trim()
  if (digits.length !== 10 || !otpVal) {
    return sendError(res, 'Mobile number and OTP are required.')
  }

  const employee = await findActiveEmployeeByMobile(digits)
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
    id:           employee._id,
    userId:       user._id,
    empCode:      employee.emp_code || '',
    name:         employee.name,
    mobile:       normaliseMobile(employee.mobile),
    email:        employee.email || '',
    department:   employee.department || '',
    designation:  employee.designation || '',
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
