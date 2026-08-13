const { sendSuccess, sendError, paginate }            = require('../utils/helpers')
const { Dispatch, Order, Sale, Payment, Notification } = require('../models')

/** GET /api/dispatches */
async function listDispatches(req, res) {
  const { status, page = 1, limit = 20 } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)

  const [total, dispatches] = await Promise.all([
    Dispatch.count(req.user.company_id, { status }),
    Dispatch.findAll(req.user.company_id, { status, limit: parseInt(limit), offset }),
  ])

  sendSuccess(res, { dispatches, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

/** GET /api/dispatches/:id */
async function getDispatch(req, res) {
  const dispatch = await Dispatch.findById(req.params.id, req.user.company_id)
  if (!dispatch) return sendError(res, 'Dispatch not found.', 404)
  sendSuccess(res, dispatch)
}

/** POST /api/dispatches */
async function createDispatch(req, res) {
  const { order_id } = req.body
  if (!order_id) return sendError(res, 'order_id is required.')

  const order = await Order.findById(order_id, req.user.company_id)
  if (!order)         return sendError(res, 'Order not found.', 404)

  const existing = await Dispatch.findByOrderId(order_id)
  if (existing)       return sendError(res, 'Dispatch already created for this order.')

  const dispatch = await Dispatch.create({
    ...req.body,
    company_id:    req.user.company_id,
    customer_name: order.customer_name,
    created_by:    req.user._id,
  })

  // Auto-deduct inventory
  if (order.product_id) {
    const { Inventory } = require('../models')
    await Inventory.deductStock(order.product_id, req.user.company_id, order.qty)
  }

  // Update order → Dispatched
  await Order.setDispatch(order_id, dispatch._id)

  await Notification.create(req.user.company_id, {
    type:         'dispatch',
    title:        `Dispatch ${dispatch.dispatch_code} Created`,
    message:      `Order ${order_id} dispatched via ${req.body.transport_name || '—'} (${req.body.vehicle_number || '—'}), LR: ${req.body.lr_number || '—'}`,
    reference_id: dispatch._id,
  })

  sendSuccess(res, dispatch, 'Dispatch created.', 201)
}

/** PATCH /api/dispatches/:id/deliver */
async function markDelivered(req, res) {
  const today    = new Date().toISOString().split('T')[0]
  const delivered = req.body.delivered_date || today

  const dispatch = await Dispatch.markDelivered(req.params.id, req.user.company_id, delivered)
  if (!dispatch) return sendError(res, 'Dispatch not found.', 404)

  const order = await Order.findById(dispatch.order_id, req.user.company_id)
  if (order) {
    // Update order → Delivered
    await Order.setDelivered(order._id)

    // Auto-create Sales entry
    const existingSale = await Sale.findByOrderId(order._id)
    if (!existingSale) {
      const sale = await Sale.create({
        company_id:    req.user.company_id,
        order_id:      order._id,
        dispatch_id:   dispatch._id,
        customer_id:   order.customer_id,
        customer_name: order.customer_name,
        product_id:    order.product_id,
        product_code:  order.product_code,
        product_name:  order.product_name,
        qty:           order.qty,
        rate:          order.rate,
        amount:        order.amount,
        gst_amount:    order.gst_amount,
        total_amount:  order.total_amount,
        sale_date:     delivered,
      })

      // Auto-create Payment Receivable
      await Payment.createReceivable({
        company_id:     req.user.company_id,
        customer_id:    order.customer_id,
        customer_name:  order.customer_name,
        order_id:       order._id,
        sale_id:        sale._id,
        invoice_amount: order.total_amount,
      })
    }

    await Notification.create(req.user.company_id, {
      type:         'delivery',
      title:        `Order ${order.order_code} Delivered`,
      message:      `Delivered to ${order.customer_name}. Sales entry & payment outstanding auto-created.`,
      reference_id: order._id,
    })
  }

  sendSuccess(res, dispatch, 'Marked as delivered. Sales entry auto-created.')
}

/** PUT /api/dispatches/:id */
async function updateDispatch(req, res) {
  const dispatch = await Dispatch.update(req.params.id, req.user.company_id, req.body)
  if (!dispatch) return sendError(res, 'Dispatch not found.', 404)
  sendSuccess(res, dispatch, 'Dispatch updated.')
}

module.exports = { listDispatches, getDispatch, createDispatch, markDelivered, updateDispatch }
