const express = require('express')
const { listOrders, getOrder, createOrder, updateOrderStatus, updateOrder, deleteOrder } = require('../controllers/orderController')

const router = express.Router()

router.get   ('/',             listOrders)
router.get   ('/:id',          getOrder)
router.post  ('/',             createOrder)
router.patch ('/:id/status',   updateOrderStatus)
router.put   ('/:id',          updateOrder)
router.delete('/:id',          deleteOrder)

module.exports = router
