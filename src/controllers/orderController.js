const { sendSuccess, sendError, paginate } = require('../utils/helpers')
const { Order, Enquiry, Notification }    = require('../models')

/** GET /api/orders */
async function listOrders(req, res) {
  try {
    const { status, search, page = 1, limit = 100 } = req.query
    const offset = (parseInt(page) - 1) * parseInt(limit)
    const [total, orders] = await Promise.all([
      Order.count(req.user.company_id, { status, search }),
      Order.findAll(req.user.company_id, { status, search, limit: parseInt(limit), offset }),
    ])
    sendSuccess(res, { orders, pagination: paginate(total, parseInt(page), parseInt(limit)) })
  } catch (err) {
    sendError(res, err.message || 'Failed to list orders.', 500)
  }
}

/** GET /api/orders/transitions */
async function getTransitions(req, res) {
  sendSuccess(res, {
    statuses:    Order.STATUSES,
    transitions: Order.TRANSITIONS,
  })
}

/** GET /api/orders/:id */
async function getOrder(req, res) {
  try {
    const order = await Order.findById(req.params.id, req.user.company_id)
    if (!order) return sendError(res, 'Order not found.', 404)
    sendSuccess(res, order)
  } catch (err) {
    sendError(res, err.message, 500)
  }
}

/** GET /api/orders/:id/next-statuses */
async function getNextStatuses(req, res) {
  try {
    const order = await Order.findById(req.params.id, req.user.company_id)
    if (!order) return sendError(res, 'Order not found.', 404)
    sendSuccess(res, {
      current: order.status,
      next:    Order.TRANSITIONS[order.status] || [],
    })
  } catch (err) {
    sendError(res, err.message, 500)
  }
}

/**
 * POST /api/orders/from-enquiry
 * Idempotent: if enquiry already has an order, returns the existing one.
 */
async function createOrderFromEnquiry(req, res) {
  try {
    const { enquiry_id } = req.body
    if (!enquiry_id) return sendError(res, 'enquiry_id is required.')

    // Guard duplicate
    const existing = await Order.findByEnquiryId(enquiry_id)
    if (existing) {
      return sendSuccess(res, existing, 'Order already exists for this enquiry.', 200)
    }

    const enquiry = await Enquiry.findById(enquiry_id, req.user.company_id)
    if (!enquiry) return sendError(res, 'Enquiry not found.', 404)
    if (enquiry.status !== 'Confirmed') {
      return sendError(res, 'Enquiry must be Confirmed before creating an order.')
    }

    const rate        = parseFloat(req.body.rate || enquiry.offered_price || 0)
    const qty         = parseFloat(enquiry.qty || 1)
    const gst_pct     = parseFloat(req.body.gst_percent || 18)
    const amount      = qty * rate
    const gst_amount  = Math.round(amount * gst_pct / 100)
    const total_amount= amount + gst_amount

    const order = await Order.create({
      company_id:       req.user.company_id,
      enquiry_id:       enquiry._id,
      enquiry_code:     enquiry.enq_code || '',
      customer_name:    enquiry.retailer_name,
      customer_mobile:  enquiry.retailer_mobile || '',
      customer_email:   enquiry.retailer_email  || '',
      delivery_address: req.body.delivery_address || enquiry.location || '',
      location:         enquiry.location || '',
      product_id:       enquiry.product_id   || null,
      product_code:     enquiry.product_code || '',
      product_name:     enquiry.product_name || '',
      unit:             enquiry.unit         || 'Pcs',
      qty, rate,
      amount, gst_percent: gst_pct, gst_amount, total_amount,
      branch_id:    req.body.branch_id   || null,
      branch_name:  req.body.branch_name || '',
      notes:        req.body.notes       || enquiry.remarks || '',
      created_by:       req.user._id,
      created_by_name:  req.user.name || '',
    })

    // Link order back to enquiry
    await Enquiry.update(enquiry_id, req.user.company_id, { order_id: order._id })

    await Notification.create(req.user.company_id, {
      type:         'order',
      title:        `Order ${order.order_code} Created`,
      message:      `Order for ${order.customer_name} from ${enquiry.enq_code} — ₹${total_amount.toLocaleString('en-IN')}`,
      reference_id: order._id,
    })

    sendSuccess(res, order, 'Order created.', 201)
  } catch (err) {
    sendError(res, err.message || 'Failed to create order.', 500)
  }
}

/** POST /api/orders (direct / backwards-compat) */
async function createOrder(req, res) {
  try {
    const { customer_name, qty, rate } = req.body
    if (!customer_name || !qty || !rate) {
      return sendError(res, 'customer_name, qty and rate are required.')
    }

    // Duplicate guard for enquiry-based creation
    if (req.body.enquiry_id) {
      const existing = await Order.findByEnquiryId(req.body.enquiry_id)
      if (existing) {
        return sendSuccess(res, existing, 'Order already exists for this enquiry.', 200)
      }
    }

    const gst_pct      = parseFloat(req.body.gst_percent   || 18)
    const purchase_rate = parseFloat(req.body.purchase_rate || 0)
    const amount        = parseFloat(qty) * parseFloat(rate)
    const gst_amount    = Math.round(amount * gst_pct / 100)
    const total_amount  = amount + gst_amount
    const purchase_cost = parseFloat(qty) * purchase_rate

    let enquiry_code = req.body.enquiry_code || ''
    if (req.body.enquiry_id && !enquiry_code) {
      try {
        const enq = await Enquiry.findById(req.body.enquiry_id, req.user.company_id)
        if (enq) enquiry_code = enq.enq_code || ''
      } catch (_) {}
    }

    const order = await Order.create({
      ...req.body,
      enquiry_code,
      company_id:      req.user.company_id,
      amount, gst_amount, total_amount,
      gst_percent:     gst_pct,
      purchase_cost,
      created_by:      req.user._id,
      created_by_name: req.user.name || '',
    })

    if (req.body.enquiry_id) {
      await Enquiry.update(req.body.enquiry_id, req.user.company_id, { order_id: order._id })
    }

    await Notification.create(req.user.company_id, {
      type:         'order',
      title:        `Order ${order.order_code} Created`,
      message:      `Order for ${customer_name} — ₹${total_amount.toLocaleString('en-IN')}`,
      reference_id: order._id,
    })

    sendSuccess(res, order, 'Order created.', 201)
  } catch (err) {
    sendError(res, err.message || 'Failed to create order.', 500)
  }
}

/**
 * PATCH /api/orders/:id/status
 * Body: { status, remarks? }
 * Enforces valid transition table, auto-generates invoice number.
 */
async function updateOrderStatus(req, res) {
  try {
    const { status, remarks } = req.body
    if (!status) return sendError(res, 'status is required.')

    const result = await Order.updateStatus(req.params.id, req.user.company_id, {
      status,
      remarks:         remarks           || '',
      updated_by:      req.user._id,
      updated_by_name: req.user.name     || '',
      updated_by_role: req.user.role     || '',
    })

    if (!result)      return sendError(res, 'Order not found.', 404)
    if (result.error) return sendError(res, result.error, 422)

    await Notification.create(req.user.company_id, {
      type:         'order',
      title:        `Order → ${status}`,
      message:      `Order ${result.order_code} status updated to ${status} by ${req.user.name || 'user'}`,
      reference_id: result._id,
    })

    sendSuccess(res, result, `Order status updated to ${status}.`)
  } catch (err) {
    sendError(res, err.message || 'Status update failed.', 500)
  }
}

/** PUT /api/orders/:id */
async function updateOrder(req, res) {
  try {
    const order = await Order.update(req.params.id, req.user.company_id, req.body)
    if (!order) return sendError(res, 'Order not found.', 404)
    sendSuccess(res, order, 'Order updated.')
  } catch (err) {
    sendError(res, err.message, 500)
  }
}

/** DELETE /api/orders/:id */
async function deleteOrder(req, res) {
  try {
    const deleted = await Order.delete(req.params.id, req.user.company_id)
    if (!deleted) return sendError(res, 'Order not found.', 404)
    sendSuccess(res, null, 'Order deleted.')
  } catch (err) {
    sendError(res, err.message, 500)
  }
}

module.exports = {
  listOrders, getTransitions, getOrder, getNextStatuses,
  createOrderFromEnquiry, createOrder,
  updateOrderStatus, updateOrder, deleteOrder,
}
