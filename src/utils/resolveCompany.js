const Company = require('../models/Company Management/Company')

/**
 * Resolves the company_id for the current request.
 * - Regular users always have company_id set by requireCompany middleware.
 * - Super Admin without a company_id can pass it explicitly via body/query.
 * - Last resort: fall back to the first company in the DB.
 *
 * @param {import('express').Request} req
 * @returns {Promise<string|null>}
 */
async function resolveCompanyId(req) {
  if (req.user?.company_id) return req.user.company_id.toString()

  const explicit = req.body?.company_id || req.query?.company_id
  if (explicit) return explicit

  const first = await Company.findOne({}).select('_id').lean()
  return first?._id?.toString() || null
}

module.exports = resolveCompanyId
