const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const Dispatch     = require('../../models/Marketplace Management/Dispatch');
const Order        = require('../../models/Marketplace Management/Order');
const Inventory    = require('../../models/Purchase & Inventory Management/Inventory');
const Sale         = require('../../models/Finance Management/Sale');
const Receivable   = require('../../models/Finance Management/Receivable');
const Notification = require('../../models/System Management/Notification');

/** GET /api/dispatches */
async function listDispatches(req, res) {
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = { company_id: req.user.company_id };
  if (status && status !== 'All') query.status = status;

  const [total, dispatches] = await Promise.all([
    Dispatch.countDocuments(query),
    Dispatch.find(query)
      .populate('order_id', 'total_amount product_name qty')
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
    .populate('order_id', 'customer_name product_name qty rate total_amount location')
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

  const existing = await Dispatch.findOne({ order_id }).select('_id').lean();
  if (existing) return sendError(res, 'Dispatch already created for this order.', 409);

  // Auto-generate dispatch_code
  const last = await Dispatch.findOne({ dispatch_code: /^DIS-/ }).sort({ dispatch_code: -1 }).lean();
  const num  = last?.dispatch_code ? parseInt(last.dispatch_code.split('-')[1], 10) : 0;
  const dispatch_code = `DIS-${String(num + 1).padStart(4, '0')}`;

  const dispatch = await Dispatch.create({
    ...req.body,
    dispatch_code,
    company_id:    req.user.company_id,
    customer_name: order.customer_name,
    status:        'Dispatched',
    created_by:    req.user._id,
  });

  // Auto-deduct inventory
  if (order.product_id) {
    await Inventory.findOneAndUpdate(
      { product_id: order.product_id, company_id: req.user.company_id },
      { $inc: { stock_out: parseFloat(order.qty), current_stock: -parseFloat(order.qty) } }
    );
  }

  // Update order status → Dispatched
  await Order.findByIdAndUpdate(order_id, { dispatch_id: dispatch._id, status: 'Dispatched' });

  await Notification.create({
    company_id:   req.user.company_id,
    type:         'dispatch',
    title:        `Dispatch ${dispatch_code} Created`,
    message:      `Order dispatched via ${req.body.transport_name || '—'} (${req.body.vehicle_number || '—'})`,
    reference_id: dispatch._id,
  });

  sendSuccess(res, dispatch, 'Dispatch created.', 201);
}

/** PATCH /api/dispatches/:id/deliver */
async function markDelivered(req, res) {
  const delivered_date = req.body.delivered_date || new Date();

  const dispatch = await Dispatch.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    { status: 'Delivered', delivered_date },
    { new: true }
  ).lean();
  if (!dispatch) return sendError(res, 'Dispatch not found.', 404);

  const order = await Order.findOne({ _id: dispatch.order_id, company_id: req.user.company_id }).lean();
  if (order) {
    // Update order → Delivered
    await Order.findByIdAndUpdate(order._id, { status: 'Delivered' });

    // Auto-create Sales entry if not already done
    const existingSale = await Sale.findOne({ order_id: order._id }).lean();
    if (!existingSale) {
      // Auto-generate sale_code
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

      // Auto-create payment receivable
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
      message:      `Delivered to ${order.customer_name}. Sales entry & receivable auto-created.`,
      reference_id: order._id,
    });
  }

  sendSuccess(res, dispatch, 'Marked as delivered. Sales entry auto-created.');
}

/** PUT /api/dispatches/:id */
async function updateDispatch(req, res) {
  const { vehicle_number, driver_name, driver_mobile, transport_name, lr_number, expected_delivery, notes } = req.body;
  const update = {};
  if (vehicle_number    !== undefined) update.vehicle_number    = vehicle_number;
  if (driver_name       !== undefined) update.driver_name       = driver_name;
  if (driver_mobile     !== undefined) update.driver_mobile     = driver_mobile;
  if (transport_name    !== undefined) update.transport_name    = transport_name;
  if (lr_number         !== undefined) update.lr_number         = lr_number;
  if (expected_delivery !== undefined) update.expected_delivery = expected_delivery || null;
  if (notes             !== undefined) update.notes             = notes;

  const dispatch = await Dispatch.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    update,
    { new: true }
  ).lean();
  if (!dispatch) return sendError(res, 'Dispatch not found.', 404);
  sendSuccess(res, dispatch, 'Dispatch updated.');
}

module.exports = { listDispatches, getDispatch, createDispatch, markDelivered, updateDispatch };
