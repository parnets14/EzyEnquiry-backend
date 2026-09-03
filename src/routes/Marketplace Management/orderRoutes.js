const express    = require('express');
const router     = express.Router();
const ctrl       = require('../../controllers/Marketplace Management/orderController');
const { authorize } = require('../../middleware/auth');

const ORDER_MANAGERS = ['Wholesaler', 'Manager', 'Company Owner', 'Super Admin', 'Sales Executive', 'Warehouse Staff', 'Accountant'];

// Static routes before :id
router.get   ('/transitions',       ctrl.getTransitions);
router.post  ('/from-enquiry',      authorize('Wholesaler', 'Manager', 'Company Owner', 'Super Admin'), ctrl.createOrderFromEnquiry);

router.get   ('/',                  ctrl.listOrders);
router.post  ('/',                  ctrl.createOrder);

router.get   ('/:id/next-statuses', ctrl.getNextStatuses);
router.get   ('/:id',               ctrl.getOrder);
router.patch ('/:id/status',        ctrl.updateOrderStatus);
router.post  ('/:id/pack',          authorize(...ORDER_MANAGERS), ctrl.packOrder);
router.put   ('/:id',               ctrl.updateOrder);
router.delete('/:id',               authorize('Manager', 'Company Owner', 'Super Admin'), ctrl.deleteOrder);

module.exports = router;
