const { sendSuccess, sendError, paginate }            = require('../utils/helpers')
const { Dispatch, Order, Sale, Payment, Notification } = require('../models')

/** GET /api/dispatches */
async function listDispatches(req, res) {
  try {
    const { status, page = 1, limit = 100 } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limit)
    const [total, dispatches] = await Promise.all([
      Dispatch.count(req.user.company_id, { status }),
      Dispatch.findAll(req.user.company_id, { status, limit: parseInt(limit), offset }),
    ])
    sendSuccess(res, { dispatches, pagination: paginate(total, parseInt(page), parseInt(limit)) })
  } catch (err) {
    sendError(res, err.message, 500)
  }
}

/** GET /api/dispatches/:id */
async function getDispatch(req, res) {
  try {
    const dispatch = await Dispatch.findById(req.params.id, req.user.company_id)
    if (!dispatch) return sendError(res, 'Dispatch not found.', 404)
    sendSuccess(res, dispatch)
  } catch (err) {
    sendError(res, err.message, 500)
  }
}

/** POST /api/dispatches */
async function createDispatch(req, res) {
  try {
    const { order_id } = req.body
    if (!order_id) return sendError(res, 'order_id is required.')

    const order = await Order.findById(order_id, req.user.company_id)
    if (!order) return sendError(res, 'Order not found.', 404)

    // Must be Ready for Dispatch
    if (order.status !== 'Ready for Dispatch') {
      return sendError(res, `Order must be "Ready for Dispatch". Current: ${order.status}`, 422)
    }

    const existing = await Dispatch.findByOrderId(order_id)
    if (existing) return sendError(res, 'Dispatch already created for this order.')

    const dispatch = await Dispatch.create({
      ...req.body,
      company_id:       req.user.company_id,
      customer_name:    order.customer_name,
      branch_name:      req.body.branch_name    || order.branch_name    || '',
      enquiry_code:     order.enquiry_code      || '',
      invoice_number:   order.invoice_number    || '',
      delivery_address: req.body.delivery_address || order.delivery_address || order.location || '',
      created_by:       req.user._id,
    })

    // Update order → Dispatched
    await Order.setDispatch(order_id, dispatch._id)

    await Notification.create(req.user.company_id, {
      type:         'dispatch',
      title:        `Dispatch ${dispatch.dispatch_code} Created`,
      message:      `Order ${order.order_code} dispatched via ${req.body.transport_name || '—'} LR: ${req.body.lr_number || '—'}`,
      reference_id: dispatch._id,
    })

    sendSuccess(res, dispatch, 'Dispatch created.', 201)
  } catch (err) {
    sendError(res, err.message || 'Dispatch creation failed.', 500)
  }
}

/** PATCH /api/dispatches/:id/intransit */
async function markInTransit(req, res) {
  try {
    const dispatch = await Dispatch.updateStatus(req.params.id, req.user.company_id, 'In Transit')
    if (!dispatch) return sendError(res, 'Dispatch not found.', 404)

    // Sync order status
    const orderId = dispatch.order_id?._id || dispatch.order_id
    if (orderId) {
      await Order.forceStatus(orderId, 'In Transit', {
        updated_by_name: req.user.name || 'Dispatch',
        remarks: 'Shipment in transit',
      })
    }

    sendSuccess(res, dispatch, 'Marked as In Transit.')
  } catch (err) {
    sendError(res, err.message, 500)
  }
}

/** PATCH /api/dispatches/:id/deliver */
async function markDelivered(req, res) {
  try {
    const today     = new Date().toISOString().split('T')[0]
    const delivered = req.body.delivered_date || today

    const dispatch = await Dispatch.markDelivered(req.params.id, req.user.company_id, delivered)
    if (!dispatch) return sendError(res, 'Dispatch not found.', 404)

    const orderId = dispatch.order_id?._id || dispatch.order_id
    const order   = orderId ? await Order.findById(orderId, req.user.company_id) : null

    if (order) {
      await Order.setDelivered(order._id, {
        delivered_date:  delivered,
        updated_by_name: req.user.name || 'Delivery',
        remarks:         req.body.pod_remarks || 'Delivered',
      })

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
        message:      `Delivered to ${order.customer_name}. Sale & receivable auto-created.`,
        reference_id: order._id,
      })
    }

    sendSuccess(res, dispatch, 'Marked as delivered. Sale auto-created.')
  } catch (err) {
    sendError(res, err.message || 'Mark delivered failed.', 500)
  }
}

/** PUT /api/dispatches/:id */
async function updateDispatch(req, res) {
  try {
    const dispatch = await Dispatch.update(req.params.id, req.user.company_id, req.body)
    if (!dispatch) return sendError(res, 'Dispatch not found.', 404)
    sendSuccess(res, dispatch, 'Dispatch updated.')
  } catch (err) {
    sendError(res, err.message, 500)
  }
}

module.exports = { listDispatches, getDispatch, createDispatch, markInTransit, markDelivered, updateDispatch }
