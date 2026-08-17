const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Marketplace Management/orderController');

router.get   ('/',           ctrl.listOrders);
router.get   ('/:id',        ctrl.getOrder);
router.post  ('/',           ctrl.createOrder);
router.patch ('/:id/status', ctrl.updateOrderStatus);
router.put   ('/:id',        ctrl.updateOrder);
router.delete('/:id',        ctrl.deleteOrder);

module.exports = router;
