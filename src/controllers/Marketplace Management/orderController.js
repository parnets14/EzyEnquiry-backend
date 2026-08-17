const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const Order        = require('../../models/Marketplace Management/Order');
const Enquiry      = require('../../models/Marketplace Management/Enquiry');
const Notification = require('../../models/System Management/Notification');

/** GET /api/orders */
async function listOrders(req, res) {
  const { status, search, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = { company_id: req.user.company_id };
  if (status && status !== 'All') query.status = status;
  if (search) {
    query.$or = [
      { customer_name: { $regex: search, $options: 'i' } },
      { order_code:    { $regex: search, $options: 'i' } },
      { product_name:  { $regex: search, $options: 'i' } },
    ];
  }

  const [total, orders] = await Promise.all([
    Order.countDocuments(query),
    Order.find(query).sort({ created_at: -1 }).skip(offset).limit(parseInt(limit)).lean(),
  ]);
  sendSuccess(res, { orders, pagination: paginate(total, parseInt(page), parseInt(limit)) });
}

/** GET /api/orders/:id */
async function getOrder(req, res) {
  const order = await Order.findOne({ _id: req.params.id, company_id: req.user.company_id })
    .populate('dispatch_id')
    .lean();
  if (!order) return sendError(res, 'Order not found.', 404);
  sendSuccess(res, order);
}

/** POST /api/orders */
async function createOrder(req, res) {
  const { customer_name, qty, rate, enquiry_id } = req.body;
  if (!customer_name || !qty || !rate)
    return sendError(res, 'Customer name, qty and rate are required.');

  const gst_percent   = parseFloat(req.body.gst_percent   || 18);
  const purchase_rate = parseFloat(req.body.purchase_rate || 0);
  const amount        = parseFloat(qty) * parseFloat(rate);
  const gst_amount    = Math.round(amount * gst_percent / 100);
  const total_amount  = amount + gst_amount;
  const purchase_cost = parseFloat(qty) * purchase_rate;

  // Auto-generate order_code
  const last = await Order.findOne({ order_code: /^ORD-/ }).sort({ order_code: -1 }).lean();
  const num  = last?.order_code ? parseInt(last.order_code.split('-')[1], 10) : 0;
  const order_code = `ORD-${String(num + 1).padStart(4, '0')}`;

  const order = await Order.create({
    ...req.body,
    order_code,
    company_id:   req.user.company_id,
    amount, gst_amount, total_amount, gst_percent, purchase_cost,
    status:       'New',
    created_by:   req.user._id,
  });

  // Mark linked enquiry as Confirmed
  if (enquiry_id) {
    await Enquiry.findOneAndUpdate(
      { _id: enquiry_id, company_id: req.user.company_id },
      { status: 'Confirmed', order_id: order._id }
    );
  }

  await Notification.create({
    company_id:   req.user.company_id,
    type:         'order',
    title:        `Order ${order_code} Created`,
    message:      `Order for ${customer_name} — ₹${total_amount.toLocaleString('en-IN')}`,
    reference_id: order._id,
  });

  sendSuccess(res, order, 'Order created.', 201);
}

/** PATCH /api/orders/:id/status */
async function updateOrderStatus(req, res) {
  const { status, warehouse_status, notes } = req.body;
  const VALID = ['New', 'Accepted', 'Processing', 'Ready', 'Dispatched', 'Delivered', 'Cancelled'];
  if (!status || !VALID.includes(status))
    return sendError(res, `Invalid status. Valid: ${VALID.join(', ')}`);

  const update = { status };
  if (warehouse_status !== undefined) update.warehouse_status = warehouse_status;
  if (notes            !== undefined) update.notes            = notes;

  const order = await Order.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    update,
    { new: true }
  ).lean();
  if (!order) return sendError(res, 'Order not found.', 404);
  sendSuccess(res, order, `Order status updated to ${order.status}.`);
}

/** PUT /api/orders/:id */
async function updateOrder(req, res) {
  const { customer_name, customer_mobile, qty, rate, gst_percent = 18, transport_cost, packing_cost, due_date, notes } = req.body;
  const amount       = parseFloat(qty) * parseFloat(rate);
  const gst_amount   = Math.round(amount * gst_percent / 100);
  const total_amount = amount + gst_amount;

  const order = await Order.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    { customer_name, customer_mobile, qty, rate, amount, gst_percent, gst_amount, total_amount, transport_cost, packing_cost, due_date: due_date || null, notes: notes || '' },
    { new: true }
  ).lean();
  if (!order) return sendError(res, 'Order not found.', 404);
  sendSuccess(res, order, 'Order updated.');
}

/** DELETE /api/orders/:id */
async function deleteOrder(req, res) {
  const result = await Order.deleteOne({ _id: req.params.id, company_id: req.user.company_id });
  if (result.deletedCount === 0) return sendError(res, 'Order not found.', 404);
  sendSuccess(res, null, 'Order deleted.');
}

module.exports = { listOrders, getOrder, createOrder, updateOrderStatus, updateOrder, deleteOrder };
