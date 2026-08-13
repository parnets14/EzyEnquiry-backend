const { sendSuccess, sendError, paginate } = require('../utils/helpers')
const { Order, Enquiry, Notification }    = require('../models')

/** GET /api/orders */
async function listOrders(req, res) {
  const { status, search, page = 1, limit = 20 } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)

  const [total, orders] = await Promise.all([
    Order.count(req.user.company_id, { status, search }),
    Order.findAll(req.user.company_id, { status, search, limit: parseInt(limit), offset }),
  ])

  sendSuccess(res, { orders, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

/** GET /api/orders/:id */
async function getOrder(req, res) {
  const order = await Order.findById(req.params.id, req.user.company_id)
  if (!order) return sendError(res, 'Order not found.', 404)
  sendSuccess(res, order)
}

/** POST /api/orders */
async function createOrder(req, res) {
  const { customer_name, qty, rate, enquiry_id } = req.body
  if (!customer_name || !qty || !rate) {
    return sendError(res, 'Customer name, qty and rate are required.')
  }

  const gst_percent  = parseFloat(req.body.gst_percent  || 18)
  const purchase_rate = parseFloat(req.body.purchase_rate || 0)
  const amount       = parseFloat(qty) * parseFloat(rate)
  const gst_amount   = Math.round(amount * gst_percent / 100)
  const total_amount = amount + gst_amount
  const purchase_cost = parseFloat(qty) * purchase_rate

  const order = await Order.create({
    ...req.body,
    company_id:    req.user.company_id,
    amount,
    gst_amount,
    total_amount,
    purchase_cost,
    gst_percent,
    created_by:    req.user._id,
  })

  // Mark enquiry as Confirmed
  if (enquiry_id) {
    await Enquiry.update(enquiry_id, req.user.company_id, { status: 'Won', order_id: order._id })
  }

  await Notification.create(req.user.company_id, {
    type:         'order',
    title:        `Order ${order.order_code} Created`,
    message:      `Order for ${customer_name} — ₹${total_amount.toLocaleString('en-IN')}`,
    reference_id: order._id,
  })

  sendSuccess(res, order, 'Order created.', 201)
}

/** PATCH /api/orders/:id/status */
async function updateOrderStatus(req, res) {
  const order = await Order.updateStatus(req.params.id, req.user.company_id, req.body)
  if (!order) return sendError(res, 'Order not found or invalid status.', 404)
  sendSuccess(res, order, `Order status updated to ${order.status}.`)
}

/** PUT /api/orders/:id */
async function updateOrder(req, res) {
  const order = await Order.update(req.params.id, req.user.company_id, req.body)
  if (!order) return sendError(res, 'Order not found.', 404)
  sendSuccess(res, order, 'Order updated.')
}

/** DELETE /api/orders/:id */
async function deleteOrder(req, res) {
  const deleted = await Order.delete(req.params.id, req.user.company_id)
  if (!deleted) return sendError(res, 'Order not found.', 404)
  sendSuccess(res, null, 'Order deleted.')
}

module.exports = { listOrders, getOrder, createOrder, updateOrderStatus, updateOrder, deleteOrder }
