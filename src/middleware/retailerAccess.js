const Company = require('../models/Company Management/Company')

async function loadCompany(req) {
  if (req.company) return req.company
  if (!req.user?.company_id) return null
  req.company = await Company.findById(req.user.company_id).lean()
  return req.company
}

async function requireRetailerIdentity(req, res, next) {
  const company = await loadCompany(req)
  if (!company || req.user?.role !== 'Retailer' || company.biz_type !== 'Retailer') {
    return res.status(403).json({ success: false, message: 'Retailer account required.' })
  }
  if (company.is_active === false) {
    return res.status(403).json({ success: false, message: 'Company account is inactive.' })
  }
  next()
}

async function requireApprovedRetailer(req, res, next) {
  const company = await loadCompany(req)
  if (!company || req.user?.role !== 'Retailer' || company.biz_type !== 'Retailer') {
    return res.status(403).json({ success: false, message: 'Retailer account required.' })
  }
  if (company.is_active === false) {
    return res.status(403).json({ success: false, message: 'Company account is inactive.' })
  }
  if (company.status !== 'Approved') {
    return res.status(403).json({
      success: false,
      message: 'Company approval is required for marketplace access.',
      data: { company_status: company.status },
    })
  }
  next()
}

async function denyRetailerErpAccess(req, res, next) {
  if (req.user?.role === 'Retailer') {
    return res.status(403).json({ success: false, message: 'Use the retailer API for this account.' })
  }
  const company = await loadCompany(req)
  if (company?.biz_type === 'Retailer') {
    return res.status(403).json({ success: false, message: 'Use the retailer API for this account.' })
  }
  next()
}

async function requireApprovedSeller(req, res, next) {
  const allowedRoles = ['Wholesaler', 'Company Owner', 'Manager', 'Sales Executive', 'Super Admin']
  if (!allowedRoles.includes(req.user?.role)) {
    return res.status(403).json({ success: false, message: 'Seller access required.' })
  }
  const company = await loadCompany(req)
  if (!company || company.biz_type === 'Retailer' || company.status !== 'Approved' || company.is_active === false) {
    return res.status(403).json({ success: false, message: 'An approved, active seller company is required.' })
  }
  next()
}

module.exports = {
  requireRetailerIdentity,
  requireApprovedRetailer,
  denyRetailerErpAccess,
  requireApprovedSeller,
}
