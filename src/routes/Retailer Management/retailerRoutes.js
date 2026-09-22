const express = require('express')

const { requireApprovedRetailer } = require('../../middleware/retailerAccess')
const { retailerKycUpload } = require('../../middleware/retailerKycUpload')
const { validateObjectIdParam } = require('../../middleware/validateObjectId')
const { uploadImages } = require('../../middleware/upload')
const marketplace = require('../../controllers/Retailer Management/retailerMarketplaceController')
const account     = require('../../controllers/Retailer Management/retailerAccountController')
const auth        = require('../../controllers/Retailer Management/retailerAuthController')
const myProducts  = require('../../controllers/Retailer Management/retailerProductController')
const staffCtrl   = require('../../controllers/Retailer Management/retailerStaffController')

// ── Catalog (categories, sub-categories, brands) scoped to retailer's company ──
const Category = require('../../models/Product Management/Category')
const Brand    = require('../../models/Product Management/Brand')

async function listRetailerCategories(req, res) {
  try {
    const cats = await Category.find({
      company_id: req.user.company_id,
      parent_id: null,
      is_active: { $ne: false },
    }).sort({ name: 1 }).select('_id name code').lean()
    res.json({ success: true, data: cats })
  } catch (e) {
    res.status(500).json({ success: false, message: e.message })
  }
}

async function listRetailerSubCategories(req, res) {
  try {
    const query = {
      company_id: req.user.company_id,
      parent_id: { $ne: null },
      is_active: { $ne: false },
    }
    if (req.query.category_id) query.parent_id = req.query.category_id
    const subs = await Category.find(query).sort({ name: 1 }).select('_id name code parent_id').lean()
    res.json({ success: true, data: subs })
  } catch (e) {
    res.status(500).json({ success: false, message: e.message })
  }
}

async function listRetailerBrands(req, res) {
  try {
    const brands = await Brand.find({
      company_id: req.user.company_id,
      is_active: { $ne: false },
    }).sort({ name: 1 }).select('_id name code').lean()
    res.json({ success: true, data: brands })
  } catch (e) {
    res.status(500).json({ success: false, message: e.message })
  }
}

async function createRetailerCategory(req, res) {
  try {
    const { name, code } = req.body
    if (!name || !String(name).trim()) return res.status(400).json({ success: false, message: 'Category name is required.' })
    const existing = await Category.findOne({ company_id: req.user.company_id, name: new RegExp(`^${name.trim()}$`, 'i'), parent_id: null }).lean()
    if (existing) return res.status(409).json({ success: false, message: `Category "${name}" already exists.` })
    const cat = await Category.create({ company_id: req.user.company_id, name: name.trim(), code: code || '', parent_id: null })
    res.status(201).json({ success: true, data: cat })
  } catch (e) {
    res.status(500).json({ success: false, message: e.message })
  }
}

async function deleteRetailerCategory(req, res) {
  try {
    const childCount = await Category.countDocuments({ company_id: req.user.company_id, parent_id: req.params.id })
    if (childCount > 0) return res.status(400).json({ success: false, message: 'Delete sub-categories first before deleting this category.' })
    const result = await Category.deleteOne({ _id: req.params.id, company_id: req.user.company_id, parent_id: null })
    if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Category not found.' })
    res.json({ success: true, message: 'Category deleted.' })
  } catch (e) {
    res.status(500).json({ success: false, message: e.message })
  }
}

async function createRetailerSubCategory(req, res) {
  try {
    const { category_id, name, code } = req.body
    if (!category_id) return res.status(400).json({ success: false, message: 'Parent category is required.' })
    if (!name || !String(name).trim()) return res.status(400).json({ success: false, message: 'Sub-category name is required.' })
    const parent = await Category.findOne({ _id: category_id, company_id: req.user.company_id, parent_id: null }).lean()
    if (!parent) return res.status(404).json({ success: false, message: 'Parent category not found.' })
    const existing = await Category.findOne({ company_id: req.user.company_id, parent_id: category_id, name: new RegExp(`^${name.trim()}$`, 'i') }).lean()
    if (existing) return res.status(409).json({ success: false, message: `Sub-category "${name}" already exists.` })
    const sub = await Category.create({ company_id: req.user.company_id, name: name.trim(), code: code || '', parent_id: category_id })
    res.status(201).json({ success: true, data: sub })
  } catch (e) {
    res.status(500).json({ success: false, message: e.message })
  }
}

async function deleteRetailerSubCategory(req, res) {
  try {
    const result = await Category.deleteOne({ _id: req.params.id, company_id: req.user.company_id, parent_id: { $ne: null } })
    if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Sub-category not found.' })
    res.json({ success: true, message: 'Sub-category deleted.' })
  } catch (e) {
    res.status(500).json({ success: false, message: e.message })
  }
}

async function createRetailerBrand(req, res) {
  try {
    const { name, code } = req.body
    if (!name || !String(name).trim()) return res.status(400).json({ success: false, message: 'Brand name is required.' })
    const existing = await Brand.findOne({ company_id: req.user.company_id, name: new RegExp(`^${name.trim()}$`, 'i') }).lean()
    if (existing) return res.status(409).json({ success: false, message: `Brand "${name}" already exists.` })
    const brand = await Brand.create({ company_id: req.user.company_id, name: name.trim(), code: code || '' })
    res.status(201).json({ success: true, data: brand })
  } catch (e) {
    res.status(500).json({ success: false, message: e.message })
  }
}

async function deleteRetailerBrand(req, res) {
  try {
    const result = await Brand.deleteOne({ _id: req.params.id, company_id: req.user.company_id })
    if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Brand not found.' })
    res.json({ success: true, message: 'Brand deleted.' })
  } catch (e) {
    res.status(500).json({ success: false, message: e.message })
  }
}

const router = express.Router()
router.param('id', validateObjectIdParam('id'))
router.param('offerId', validateObjectIdParam('offerId'))

// ── Module guard for RetailerStaff ───────────────────────────
// When a RetailerStaff token is used, check their staff_app_access list.
// Empty list = all modules accessible. Non-empty = only listed modules.
function requireRetailerModule(moduleKey) {
  return (req, res, next) => {
    // Retailer owner always passes — only restrict staff
    if (req.user?.role !== 'RetailerStaff') return next()
    const access = req.retailerStaff?.staff_app_access || []
    if (access.length === 0) return next()  // no restriction
    if (access.includes(moduleKey)) return next()
    return res.status(403).json({
      success: false,
      message: `Access denied. You do not have access to the ${moduleKey} module.`,
      module: moduleKey,
    })
  }
}

// ── Staff Management (owner only) ────────────────────────────
// RetailerStaff cannot access these — ownerOnly() guard inside controller.
// GET /modules first so it isn't consumed as /:id param.
router.get   ('/staff/modules',    staffCtrl.getAvailableModules)
router.get   ('/staff',            staffCtrl.listStaff)
router.post  ('/staff',            staffCtrl.addStaff)
router.get   ('/staff/:id',        staffCtrl.getStaff)
router.put   ('/staff/:id',        staffCtrl.updateStaff)
router.patch ('/staff/:id/toggle', staffCtrl.toggleStaffActive)
router.delete('/staff/:id',        staffCtrl.deleteStaff)

// ── Catalog — categories, sub-categories, brands (retailer's own company) ──
router.get   ('/catalog/categories',          listRetailerCategories)
router.post  ('/catalog/categories',          createRetailerCategory)
router.delete('/catalog/categories/:id',      deleteRetailerCategory)
router.get   ('/catalog/sub-categories',      listRetailerSubCategories)
router.post  ('/catalog/sub-categories',      createRetailerSubCategory)
router.delete('/catalog/sub-categories/:id',  deleteRetailerSubCategory)
router.get   ('/catalog/brands',              listRetailerBrands)
router.post  ('/catalog/brands',              createRetailerBrand)
router.delete('/catalog/brands/:id',          deleteRetailerBrand)

// Pending-safe account, approval, and KYC flow.
// Staff can view profile & config but not change password or upload KYC docs.
router.get('/config',   account.getCapabilities)
router.get('/profile',  requireRetailerModule('dashboard'), account.getProfile)
router.put('/profile',  account.updateProfile)       // owner only in practice
router.get('/company',  account.getCompany)
router.put('/company',  account.updateCompany)
router.patch('/change-password', account.changePassword)
router.get('/addresses',       account.listAddresses)
router.post('/addresses',      account.addAddress)
router.put('/addresses/:id',   account.updateAddress)
router.delete('/addresses/:id',account.deleteAddress)
router.get('/kyc/documents',                    account.getKycDocuments)
router.get('/kyc/documents/:type/download',     account.downloadKycDocument)
router.post('/kyc/documents', retailerKycUpload, auth.uploadDocs)

// Dashboard & Products — visible to all (owner + staff with access)
router.get('/dashboard', requireRetailerModule('dashboard'), marketplace.dashboard)
router.get('/products',  requireRetailerModule('products'),  marketplace.listProducts)
router.get('/products/:id', requireRetailerModule('products'), marketplace.getProduct)

// Notifications
router.get   ('/notifications',          requireRetailerModule('notifications'), marketplace.listNotifications)
router.patch ('/notifications/read-all', requireRetailerModule('notifications'), marketplace.readAllNotifications)
router.patch ('/notifications/:id/read', requireRetailerModule('notifications'), marketplace.readNotification)
router.delete('/notifications/:id',      requireRetailerModule('notifications'), marketplace.deleteNotification)

// Approved, active retailer business APIs.
router.use(requireApprovedRetailer)

// Customers
router.get   ('/customers',     requireRetailerModule('customers'), marketplace.listRetailerCustomers)
router.post  ('/customers',     requireRetailerModule('customers'), marketplace.createRetailerCustomer)
router.put   ('/customers/:id', requireRetailerModule('customers'), marketplace.updateRetailerCustomer)
router.delete('/customers/:id', requireRetailerModule('customers'), marketplace.deleteRetailerCustomer)

// Enquiries
router.get   ('/enquiries',                        requireRetailerModule('enquiries'), marketplace.listEnquiries)
router.post  ('/enquiries',                        requireRetailerModule('enquiries'), marketplace.createEnquiry)
router.get   ('/enquiries/:id',                    requireRetailerModule('enquiries'), marketplace.getEnquiry)
router.patch ('/enquiries/:id/cancel',             requireRetailerModule('enquiries'), marketplace.cancelEnquiry)
router.get   ('/enquiries/:id/messages',           requireRetailerModule('enquiries'), marketplace.listMessages)
router.post  ('/enquiries/:id/messages',           requireRetailerModule('enquiries'), marketplace.createBuyerMessage)
router.get   ('/enquiries/:id/offers',             requireRetailerModule('enquiries'), marketplace.listOffers)
router.patch ('/enquiries/:id/offers/:offerId',    requireRetailerModule('enquiries'), marketplace.respondToOffer)

// My Products (retailer's own products)
router.get   ('/my-products',      myProducts.listMyProducts)
router.post  ('/my-products',      uploadImages, myProducts.createMyProduct)
router.get   ('/my-products/:id',  myProducts.getMyProduct)
router.put   ('/my-products/:id',  uploadImages, myProducts.updateMyProduct)
router.delete('/my-products/:id',  myProducts.deleteMyProduct)

// Orders
router.get  ('/orders',                           requireRetailerModule('orders'), marketplace.listOrders)
router.post ('/orders',                           requireRetailerModule('orders'), marketplace.createOrder)
router.get  ('/orders/:id',                       requireRetailerModule('orders'), marketplace.getOrder)
router.patch('/orders/:id/cancel',                requireRetailerModule('orders'), marketplace.cancelOrder)
router.get  ('/orders/:id/tracking',              requireRetailerModule('orders'), marketplace.tracking)
router.get  ('/orders/:id/dispatches',            requireRetailerModule('orders'), marketplace.listOrderDispatches)
router.get  ('/orders/:id/invoices',              requireRetailerModule('orders'), marketplace.listOrderInvoices)
router.post ('/orders/:id/delivery-otp',          requireRetailerModule('orders'), marketplace.requestDeliveryOtp)
router.post ('/orders/:id/delivery-otp/verify',   requireRetailerModule('orders'), marketplace.confirmDeliveryOtp)

// Invoices
router.get ('/invoices',            requireRetailerModule('invoices'), marketplace.listInvoices)
router.get ('/invoices/:id',        requireRetailerModule('invoices'), marketplace.getInvoice)
router.post('/invoices/:id/pay',    requireRetailerModule('invoices'), marketplace.initiatePayment)
router.post('/invoices/:id/pay/confirm', requireRetailerModule('invoices'), marketplace.confirmPayment)

// Subscription (owner only in practice)
router.get('/subscription/plans',   account.getPlans)
router.get('/subscription/current', account.getCurrentSubscription)

module.exports = router
