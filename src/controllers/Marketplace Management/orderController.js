const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const Order        = require('../../models/Marketplace Management/Order');
const Enquiry      = require('../../models/Marketplace Management/Enquiry');
const Notification = require('../../models/System Management/Notification');
const { notifyRetailer } = require('../../utils/pushHelper');

const ORDER_STATUSES = [
  'New', 'Pending Approval', 'Approved',
  'Picking Started', 'Picking Completed',
  'Sorting Started', 'Sorting Completed',
  'Packing Started', 'Packing Completed',
  'Invoice Generated', 'Ready for Dispatch',
  'Dispatched', 'In Transit', 'Delivered', 'Cancelled',
];

const VALID_TRANSITIONS = {
  'New':               ['Pending Approval', 'Cancelled'],
  'Pending Approval':  ['Approved', 'Cancelled'],
  'Approved':          ['Picking Started', 'Cancelled'],
  'Picking Started':   ['Picking Completed', 'Cancelled'],
  'Picking Completed': ['Sorting Started'],
  'Sorting Started':   ['Sorting Completed'],
  'Sorting Completed': ['Packing Started'],
  'Packing Started':   ['Packing Completed'],
  'Packing Completed': ['Invoice Generated'],
  'Invoice Generated': ['Ready for Dispatch'],
  'Ready for Dispatch':['Dispatched'],
  'Dispatched':        ['In Transit'],
  'In Transit':        ['Delivered'],
  'Delivered':         [],
  'Cancelled':         [],
};

const ORDER_MANAGERS = ['Wholesaler', 'Manager', 'Company Owner', 'Super Admin', 'Sales Executive', 'Warehouse Staff', 'Accountant'];

/** GET /api/orders */
async function listOrders(req, res) {
  const { status, search, page = 1, limit = 100 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = { company_id: req.user.company_id };
  if (status && status !== 'All') query.status = status;
  if (search) {
    query.$or = [
      { customer_name: { $regex: search, $options: 'i' } },
      { order_code:    { $regex: search, $options: 'i' } },
      { product_name:  { $regex: search, $options: 'i' } },
      { enquiry_code:  { $regex: search, $options: 'i' } },
      { branch_name:   { $regex: search, $options: 'i' } },
    ];
  }

  const [total, orders] = await Promise.all([
    Order.countDocuments(query),
    Order.find(query).sort({ created_at: -1 }).skip(offset).limit(parseInt(limit)).lean(),
  ]);
  sendSuccess(res, { orders, pagination: paginate(total, parseInt(page), parseInt(limit)) });
}

/** GET /api/orders/transitions */
async function getTransitions(req, res) {
  sendSuccess(res, { statuses: ORDER_STATUSES, transitions: VALID_TRANSITIONS });
}

/** GET /api/orders/:id */
async function getOrder(req, res) {
  const order = await Order.findOne({ _id: req.params.id, company_id: req.user.company_id })
    .populate('dispatch_id')
    .lean();
  if (!order) return sendError(res, 'Order not found.', 404);
  sendSuccess(res, order);
}

/** GET /api/orders/:id/next-statuses */
async function getNextStatuses(req, res) {
  const order = await Order.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
  if (!order) return sendError(res, 'Order not found.', 404);
  sendSuccess(res, {
    current: order.status,
    next:    VALID_TRANSITIONS[order.status] || [],
  });
}

/** POST /api/orders/from-enquiry — idempotent */
async function createOrderFromEnquiry(req, res) {
  const { enquiry_id } = req.body;
  if (!enquiry_id) return sendError(res, 'enquiry_id is required.');

  const existing = await Order.findOne({ enquiry_id }).select('_id order_code status').lean();
  if (existing) return sendSuccess(res, existing, 'Order already exists for this enquiry.', 200);

  const enquiry = await Enquiry.findOne({ _id: enquiry_id, company_id: req.user.company_id }).lean();
  if (!enquiry) return sendError(res, 'Enquiry not found.', 404);
  if (enquiry.buyer_company_id) {
    return sendError(res, 'Retailer marketplace orders must be created by the buyer from an accepted offer.', 409);
  }
  if (enquiry.status !== 'Confirmed')
    return sendError(res, 'Enquiry must be Confirmed before creating an order.');

  const rate        = parseFloat(req.body.rate || enquiry.offered_price || 0);
  const qty         = parseFloat(enquiry.qty || 1);
  const gst_pct     = parseFloat(req.body.gst_percent || 18);
  const amount      = qty * rate;
  const gst_amount  = Math.round(amount * gst_pct / 100);
  const total_amount= amount + gst_amount;

  // Auto-generate order_code
  const year   = new Date().getFullYear();
  const prefix = `ORD-${year}-`;
  const last   = await Order.findOne({ order_code: { $regex: `^${prefix}` } }).sort({ order_code: -1 }).lean();
  const parts  = last?.order_code?.split('-') || [];
  const num    = parseInt(parts[parts.length - 1] || 0, 10);
  const order_code = `${prefix}${String(num + 1).padStart(6, '0')}`;

  const order = await Order.create({
    order_code,
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
    branch_id:        req.body.branch_id   || null,
    branch_name:      req.body.branch_name || '',
    notes:            req.body.notes       || enquiry.remarks || '',
    created_by:       req.user._id,
    created_by_name:  req.user.name || '',
    status:           'New',
    order_date:       new Date(),
    status_history: [{
      status:          'New',
      updated_by_name: req.user.name || 'System',
      remarks:         'Order created from enquiry',
      timestamp:       new Date(),
    }],
  });

  // Link order back to enquiry
  await Enquiry.findOneAndUpdate(
    { _id: enquiry_id, company_id: req.user.company_id },
    { order_id: order._id }
  );

  await Notification.create({
    company_id:   req.user.company_id,
    type:         'order',
    title:        `Order ${order_code} Created`,
    message:      `Order for ${order.customer_name} from ${enquiry.enq_code} — ₹${total_amount.toLocaleString('en-IN')}`,
    reference_id: order._id,
  });

  sendSuccess(res, order, 'Order created.', 201);
}

/** POST /api/orders */
async function createOrder(req, res) {
  if (!ORDER_MANAGERS.includes(req.user?.role)) {
    return sendError(res, 'Access denied.', 403);
  }

  const { customer_name, qty, rate } = req.body;
  if (!customer_name || !qty || !rate)
    return sendError(res, 'customer_name, qty and rate are required.');

  // Duplicate guard
  if (req.body.enquiry_id) {
    const existing = await Order.findOne({ enquiry_id: req.body.enquiry_id }).select('_id order_code status').lean();
    if (existing) return sendSuccess(res, existing, 'Order already exists for this enquiry.', 200);
  }

  const gst_pct      = parseFloat(req.body.gst_percent   || 18);
  const purchase_rate = parseFloat(req.body.purchase_rate || 0);
  const amount        = parseFloat(qty) * parseFloat(rate);
  const gst_amount    = Math.round(amount * gst_pct / 100);
  const total_amount  = amount + gst_amount;
  const purchase_cost = parseFloat(qty) * purchase_rate;

  const year   = new Date().getFullYear();
  const prefix = `ORD-${year}-`;
  const last   = await Order.findOne({ order_code: { $regex: `^${prefix}` } }).sort({ order_code: -1 }).lean();
  const parts  = last?.order_code?.split('-') || [];
  const num    = parseInt(parts[parts.length - 1] || 0, 10);
  const order_code = `${prefix}${String(num + 1).padStart(6, '0')}`;

  // Resolve enquiry_code if not supplied
  let enquiry_code = req.body.enquiry_code || '';
  if (req.body.enquiry_id && !enquiry_code) {
    const enq = await Enquiry.findOne({ _id: req.body.enquiry_id, company_id: req.user.company_id }).lean();
    if (enq) enquiry_code = enq.enq_code || '';
  }

  const order = await Order.create({
    ...req.body,
    order_code,
    enquiry_code,
    company_id:      req.user.company_id,
    buyer_company_id: null,
    buyer_user_id:    null,
    seller_company_id:null,
    offer_id:         null,
    amount, gst_amount, total_amount,
    gst_percent:     gst_pct,
    purchase_cost,
    status:          'New',
    order_date:      new Date(),
    created_by:      req.user._id,
    created_by_name: req.user.name || '',
    status_history: [{
      status:          'New',
      updated_by_name: req.user.name || 'System',
      remarks:         'Order created',
      timestamp:       new Date(),
    }],
  });

  if (req.body.enquiry_id) {
    await Enquiry.findOneAndUpdate(
      { _id: req.body.enquiry_id, company_id: req.user.company_id },
      { order_id: order._id }
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
  const { status, remarks } = req.body;
  if (!status) return sendError(res, 'status is required.');
  if (!ORDER_STATUSES.includes(status)) return sendError(res, `Invalid status: ${status}`);

  const order = await Order.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
  if (!order) return sendError(res, 'Order not found.', 404);

  const allowed = VALID_TRANSITIONS[order.status] || [];
  if (!allowed.includes(status)) {
    return sendError(res, `Cannot transition from "${order.status}" to "${status}". Allowed: ${allowed.join(', ') || 'none'}`, 422);
  }

  const histEntry = {
    status,
    updated_by:      req.user._id,
    updated_by_name: req.user.name || '',
    updated_by_role: req.user.role || '',
    remarks:         remarks || '',
    timestamp:       new Date(),
  };

  let updated = await Order.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    { status, $push: { status_history: histEntry } },
    { new: true }
  ).lean();

  // Auto-generate invoice number when moving to Invoice Generated
  if (status === 'Invoice Generated' && updated) {
    const invYear   = new Date().getFullYear();
    const invPrefix = `INV-${invYear}-`;
    const lastInv   = await Order.findOne({ company_id: req.user.company_id, invoice_number: { $regex: `^${invPrefix}` } })
      .sort({ invoice_number: -1 }).lean();
    const invParts  = lastInv?.invoice_number?.split('-') || [];
    const invNum    = parseInt(invParts[invParts.length - 1] || 0, 10);
    const invoice_number = `${invPrefix}${String(invNum + 1).padStart(6, '0')}`;
    updated = await Order.findByIdAndUpdate(
      req.params.id,
      { invoice_number, invoice_date: new Date() },
      { new: true }
    ).lean();
  }

  const notifications = [Notification.create({
    company_id:   req.user.company_id,
    type:         'order',
    title:        `Order → ${status}`,
    message:      `Order ${updated.order_code} status updated to ${status} by ${req.user.name || 'user'}`,
    reference_id: updated._id,
  })];
  if (updated.buyer_company_id && updated.buyer_user_id) {
    notifications.push(Notification.create({
      company_id: updated.buyer_company_id,
      user_id: updated.buyer_user_id,
      type: 'order_status',
      title: `Order ${updated.order_code} updated`,
      message: `Your order status is now ${status}.`,
      reference_id: updated._id,
    }));
    // Push notification to retailer buyer
    notifyRetailer(updated.buyer_user_id, {
      title: `Order ${updated.order_code} Updated`,
      body: `Your order status is now: ${status}`,
      type: 'order_status',
      referenceId: updated._id,
    });
  }
  await Promise.all(notifications);

  sendSuccess(res, updated, `Order status updated to ${status}.`);
}

/** PUT /api/orders/:id */
async function updateOrder(req, res) {
  const existingOrder = await Order.findOne({ _id: req.params.id, company_id: req.user.company_id })
    .select('buyer_company_id')
    .lean();
  if (!existingOrder) return sendError(res, 'Order not found.', 404);
  if (existingOrder.buyer_company_id) {
    return sendError(res, 'Commercial fields on retailer marketplace orders are fixed by the accepted offer.', 409);
  }

  const {
    customer_name, customer_mobile, customer_email, delivery_address, location,
    qty, rate, gst_percent, transport_cost, packing_cost, due_date, notes,
    branch_id, branch_name, unit,
  } = req.body;
  const amount       = parseFloat(qty) * parseFloat(rate);
  const gst_amount   = Math.round(amount * parseFloat(gst_percent || 18) / 100);
  const total_amount = amount + gst_amount;

  const order = await Order.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    {
      customer_name, customer_mobile: customer_mobile || '',
      customer_email:   customer_email   || '',
      delivery_address: delivery_address || location || '',
      location:         location         || '',
      qty, rate, amount, gst_percent: gst_percent || 18, gst_amount, total_amount,
      transport_cost: transport_cost || 0, packing_cost: packing_cost || 0,
      due_date: due_date || null, notes: notes || '',
      branch_id: branch_id || null, branch_name: branch_name || '',
      unit: unit || 'Pcs',
    },
    { new: true }
  ).lean();
  if (!order) return sendError(res, 'Order not found.', 404);
  sendSuccess(res, order, 'Order updated.');
}

/** DELETE /api/orders/:id */
async function deleteOrder(req, res) {
  const order = await Order.findOne({ _id: req.params.id, company_id: req.user.company_id })
    .select('buyer_company_id')
    .lean();
  if (!order) return sendError(res, 'Order not found.', 404);
  if (order.buyer_company_id) {
    return sendError(res, 'Retailer marketplace orders cannot be hard-deleted.', 409);
  }
  await Order.deleteOne({ _id: order._id, company_id: req.user.company_id });
  sendSuccess(res, null, 'Order deleted.');
}

module.exports = {
  listOrders, getTransitions, getOrder, getNextStatuses,
  createOrderFromEnquiry, createOrder,
  updateOrderStatus, updateOrder, deleteOrder,
};
