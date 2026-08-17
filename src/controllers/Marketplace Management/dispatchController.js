const { sendSuccess, sendError, paginate }  = require('../../utils/helpers');
const Dispatch     = require('../../models/Marketplace Management/Dispatch');
const Order        = require('../../models/Marketplace Management/Order');
const Sale         = require('../../models/Finance Management/Sale');
const Receivable   = require('../../models/Finance Management/Receivable');
const Notification = require('../../models/System Management/Notification');

/** GET /api/dispatches */
async function listDispatches(req, res) {
  const { status, page = 1, limit = 100 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = { company_id: req.user.company_id };
  if (status && status !== 'All') query.status = status;

  const [total, dispatches] = await Promise.all([
    Dispatch.countDocuments(query),
    Dispatch.find(query)
      .populate('order_id', 'order_code product_name qty total_amount branch_name enquiry_code invoice_number delivery_address location')
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(parseInt(limit))
      .lean(),
  ]);
  sendSuccess(res, { dispatches, pagination: paginate(total, parseInt(page), parseInt(limit)) });
}

/** GET /api/dispatches/:id */
async function getDispatch(req, res) {
  const dispatch = await Dispatch.findOne({ _id: req.params.id, company_id: req.user.company_id })
    .populate('order_id', 'order_code customer_name product_name qty rate total_amount delivery_address location enquiry_code invoice_number')
    .lean();
  if (!dispatch) return sendError(res, 'Dispatch not found.', 404);
  sendSuccess(res, dispatch);
}

/** POST /api/dispatches */
async function createDispatch(req, res) {
  const { order_id } = req.body;
  if (!order_id) return sendError(res, 'order_id is required.');

  const order = await Order.findOne({ _id: order_id, company_id: req.user.company_id }).lean();
  if (!order) return sendError(res, 'Order not found.', 404);

  if (order.status !== 'Ready for Dispatch') {
    return sendError(res, `Order must be "Ready for Dispatch". Current: ${order.status}`, 422);
  }

  const existing = await Dispatch.findOne({ order_id }).select('_id dispatch_code status').lean();
  if (existing) return sendError(res, 'Dispatch already created for this order.', 409);

  // Auto-generate dispatch_code
  const last = await Dispatch.findOne({ dispatch_code: /^DIS-/ }).sort({ dispatch_code: -1 }).lean();
  const num  = last?.dispatch_code ? parseInt(last.dispatch_code.split('-')[1], 10) : 0;
  const dispatch_code = `DIS-${String(num + 1).padStart(4, '0')}`;

  // Auto-calc expected delivery date from days if not supplied
  let expected_delivery = req.body.expected_delivery || null;
  if (!expected_delivery && req.body.expected_delivery_days && req.body.dispatch_date) {
    const d = new Date(req.body.dispatch_date);
    d.setDate(d.getDate() + parseInt(req.body.expected_delivery_days));
    expected_delivery = d;
  }

  const dispatch = await Dispatch.create({
    ...req.body,
    dispatch_code,
    company_id:       req.user.company_id,
    customer_name:    order.customer_name,
    branch_name:      req.body.branch_name    || order.branch_name    || '',
    enquiry_code:     order.enquiry_code      || '',
    invoice_number:   order.invoice_number    || '',
    delivery_address: req.body.delivery_address || order.delivery_address || order.location || '',
    expected_delivery,
    status:           'Dispatched',
    created_by:       req.user._id,
  });

  // Update order → Dispatched
  await Order.findByIdAndUpdate(order_id, {
    dispatch_id: dispatch._id,
    status:      'Dispatched',
    $push: {
      status_history: {
        status:          'Dispatched',
        updated_by_name: req.user.name || 'Dispatch',
        remarks:         'Dispatch created',
        timestamp:       new Date(),
      },
    },
  });

  await Notification.create({
    company_id:   req.user.company_id,
    type:         'dispatch',
    title:        `Dispatch ${dispatch_code} Created`,
    message:      `Order ${order.order_code} dispatched via ${req.body.transport_name || '—'} LR: ${req.body.lr_number || '—'}`,
    reference_id: dispatch._id,
  });

  sendSuccess(res, dispatch, 'Dispatch created.', 201);
}

/** PATCH /api/dispatches/:id/intransit */
async function markInTransit(req, res) {
  const dispatch = await Dispatch.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    { status: 'In Transit' },
    { new: true }
  ).lean();
  if (!dispatch) return sendError(res, 'Dispatch not found.', 404);

  const orderId = dispatch.order_id?._id || dispatch.order_id;
  if (orderId) {
    await Order.findByIdAndUpdate(orderId, {
      status: 'In Transit',
      $push: {
        status_history: {
          status:          'In Transit',
          updated_by_name: req.user.name || 'Dispatch',
          remarks:         'Shipment in transit',
          timestamp:       new Date(),
        },
      },
    });
  }
  sendSuccess(res, dispatch, 'Marked as In Transit.');
}

/** PATCH /api/dispatches/:id/deliver */
async function markDelivered(req, res) {
  const delivered_date = req.body.delivered_date || new Date().toISOString().split('T')[0];

  const dispatch = await Dispatch.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    { status: 'Delivered', delivered_date },
    { new: true }
  ).lean();
  if (!dispatch) return sendError(res, 'Dispatch not found.', 404);

  const orderId = dispatch.order_id?._id || dispatch.order_id;
  const order   = orderId
    ? await Order.findOne({ _id: orderId, company_id: req.user.company_id }).lean()
    : null;

  if (order) {
    await Order.findByIdAndUpdate(order._id, {
      status:         'Delivered',
      delivered_date: delivered_date,
      $push: {
        status_history: {
          status:          'Delivered',
          updated_by_name: req.user.name || 'Delivery',
          remarks:         req.body.pod_remarks || 'Delivered',
          timestamp:       new Date(),
        },
      },
    });

    // Auto-create Sales entry if not already done
    const existingSale = await Sale.findOne({ order_id: order._id }).lean();
    if (!existingSale) {
      const lastSale = await Sale.findOne({ sale_code: /^SAL-/ }).sort({ sale_code: -1 }).lean();
      const sNum = lastSale?.sale_code ? parseInt(lastSale.sale_code.split('-')[1], 10) : 0;
      const sale_code = `SAL-${String(sNum + 1).padStart(4, '0')}`;

      const sale = await Sale.create({
        sale_code,
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
        sale_date:     delivered_date,
      });

      // Auto-create Receivable
      const lastRcv = await Receivable.findOne({ rcv_code: /^RCV-/ }).sort({ rcv_code: -1 }).lean();
      const rNum = lastRcv?.rcv_code ? parseInt(lastRcv.rcv_code.split('-')[1], 10) : 0;
      await Receivable.create({
        rcv_code:       `RCV-${String(rNum + 1).padStart(4, '0')}`,
        company_id:     req.user.company_id,
        customer_id:    order.customer_id,
        customer_name:  order.customer_name,
        order_id:       order._id,
        sale_id:        sale._id,
        invoice_amount: order.total_amount,
        received:       0,
        outstanding:    order.total_amount,
        status:         'Pending',
      });
    }

    await Notification.create({
      company_id:   req.user.company_id,
      type:         'delivery',
      title:        `Order ${order.order_code} Delivered`,
      message:      `Delivered to ${order.customer_name}. Sale & receivable auto-created.`,
      reference_id: order._id,
    });
  }

  sendSuccess(res, dispatch, 'Marked as delivered. Sale auto-created.');
}

/** PUT /api/dispatches/:id */
async function updateDispatch(req, res) {
  const {
    vehicle_number, driver_name, driver_mobile,
    transport_name, lr_number,
    branch_name, delivery_address,
    expected_delivery_days, expected_delivery,
    notes,
  } = req.body;

  let deliveryDate = expected_delivery || undefined;
  if (expected_delivery_days && !expected_delivery) {
    const existing = await Dispatch.findOne({ _id: req.params.id, company_id: req.user.company_id })
      .select('dispatch_date').lean();
    if (existing?.dispatch_date) {
      const d = new Date(existing.dispatch_date);
      d.setDate(d.getDate() + parseInt(expected_delivery_days));
      deliveryDate = d;
    }
  }

  const upd = { notes: notes || '' };
  if (vehicle_number    !== undefined) upd.vehicle_number    = vehicle_number;
  if (driver_name       !== undefined) upd.driver_name       = driver_name;
  if (driver_mobile     !== undefined) upd.driver_mobile     = driver_mobile;
  if (transport_name    !== undefined) upd.transport_name    = transport_name;
  if (lr_number         !== undefined) upd.lr_number         = lr_number;
  if (branch_name       !== undefined) upd.branch_name       = branch_name;
  if (delivery_address  !== undefined) upd.delivery_address  = delivery_address;
  if (expected_delivery_days !== undefined) upd.expected_delivery_days = expected_delivery_days ? parseInt(expected_delivery_days) : null;
  if (deliveryDate !== undefined) upd.expected_delivery = deliveryDate || null;

  const dispatch = await Dispatch.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    upd,
    { new: true }
  ).lean();
  if (!dispatch) return sendError(res, 'Dispatch not found.', 404);
  sendSuccess(res, dispatch, 'Dispatch updated.');
}

module.exports = { listDispatches, getDispatch, createDispatch, markInTransit, markDelivered, updateDispatch };
