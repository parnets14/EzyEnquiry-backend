const express    = require('express')
const { authorize } = require('../middleware/auth')
const {
  listOrders, getTransitions, getOrder, getNextStatuses,
  createOrderFromEnquiry, createOrder,
  updateOrderStatus, updateOrder, deleteOrder,
} = require('../controllers/orderController')

const router = express.Router()

// Roles that can manage orders (not Retailer)
const ORDER_MANAGERS = ['Wholesaler', 'Manager', 'Company Owner', 'Super Admin', 'Sales Executive', 'Warehouse Staff', 'Accountant']

// Static routes before :id
router.get   ('/transitions',       getTransitions)
router.post  ('/from-enquiry',      authorize('Wholesaler', 'Manager', 'Company Owner', 'Super Admin'), createOrderFromEnquiry)

router.get   ('/',                  listOrders)
router.post  ('/',                  authorize(...ORDER_MANAGERS), createOrder)

router.get   ('/:id/next-statuses', getNextStatuses)
router.get   ('/:id',               getOrder)
router.patch ('/:id/status',        authorize(...ORDER_MANAGERS), updateOrderStatus)
router.put   ('/:id',               authorize(...ORDER_MANAGERS), updateOrder)
router.delete('/:id',               authorize('Manager', 'Company Owner', 'Super Admin'), deleteOrder)

module.exports = router
