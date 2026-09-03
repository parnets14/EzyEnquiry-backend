const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const Order        = require('../../models/Marketplace Management/Order');
const Enquiry      = require('../../models/Marketplace Management/Enquiry');
const Notification = require('../../models/System Management/Notification');
const Invoice      = require('../../models/Finance Management/Invoice');
const Dispatch     = require('../../models/Marketplace Management/Dispatch');
const Company      = require('../../models/Company Management/Company');
const User         = require('../../models/User Management/User');
const { notifyRetailer } = require('../../utils/pushHelper');

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

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

// ─────────────────────────────────────────────────────────────────────────────
// Code generators for the partial-pack flow
// ─────────────────────────────────────────────────────────────────────────────
async function nextInvoiceNo(companyId) {
  const last = await Invoice.findOne({ company_id: companyId, invoice_no: /^INV-/ })
    .sort({ created_at: -1 }).select('invoice_no').lean();
  const num = last?.invoice_no ? parseInt(String(last.invoice_no).split('-').pop(), 10) : 0;
  return `INV-${String((num || 0) + 1).padStart(4, '0')}`;
}

async function nextDispatchCode() {
  const last = await Dispatch.findOne({ dispatch_code: /^DIS-/ }).sort({ dispatch_code: -1 }).select('dispatch_code').lean();
  const num = last?.dispatch_code ? parseInt(String(last.dispatch_code).split('-')[1], 10) : 0;
  return `DIS-${String((num || 0) + 1).padStart(4, '0')}`;
}

/**
 * POST /api/orders/:id/pack
 * Partial packing: pack a slice of the order (pack_qty), create an Invoice + a
 * Dispatch for exactly that quantity, update the order's packed/dispatched
 * counters, and append a package record. Repeat until fully fulfilled.
 *
 * Body: { pack_qty, vehicle_number, driver_name, driver_mobile, transport_name,
 *         lr_number, dispatch_date, expected_delivery_days, expected_delivery, branch_name }
 */
async function packOrder(req, res) {
  const order = await Order.findOne({ _id: req.params.id, company_id: req.user.company_id });
  if (!order) return sendError(res, 'Order not found.', 404);
  if (['Cancelled'].includes(order.status)) return sendError(res, 'Cancelled orders cannot be packed.', 409);

  const orderedQty     = Number(order.qty) || 0;
  const alreadyShipped = Number(order.dispatched_qty) || 0;
  const remaining      = round2(orderedQty - alreadyShipped);
  if (remaining <= 0) return sendError(res, 'This order is already fully dispatched.', 409);

  // Default to the full remaining quantity if none provided.
  let packQty = req.body.pack_qty === undefined || req.body.pack_qty === '' ? remaining : Number(req.body.pack_qty);
  if (!(packQty > 0)) return sendError(res, 'pack_qty must be greater than zero.', 400);
  if (packQty > remaining) return sendError(res, `pack_qty cannot exceed the remaining quantity (${remaining}).`, 400);
  packQty = round2(packQty);

  const rate       = Number(order.rate) || 0;
  const gstPercent = Number(order.gst_percent) || 0;
  const amount     = round2(packQty * rate);
  const gstAmount  = round2(amount * gstPercent / 100);
  const total      = round2(amount + gstAmount);

  const packNo = (order.packages?.length || 0) + 1;

  // The admin/seller company that is issuing this invoice.
  const sellerCompany = await Company.findById(req.user.company_id).select('name mobile email').lean().catch(() => null);

  // Resolve the retailer (buyer) authoritatively from the order's buyer ids,
  // so the invoice never mislabels the admin as the retailer.
  let retailer = {
    name: order.created_by_person || '',
    company: order.created_by_company || '',
    mobile: order.created_by_mobile || '',
    email: order.created_by_email || '',
  };
  if (order.buyer_company_id) {
    const [buyerCompany, buyerUser] = await Promise.all([
      Company.findById(order.buyer_company_id).select('name mobile email').lean().catch(() => null),
      order.buyer_user_id ? User.findById(order.buyer_user_id).select('name mobile email').lean().catch(() => null) : null,
    ]);
    if (buyerCompany || buyerUser) {
      retailer = {
        name: buyerUser?.name || retailer.name || buyerCompany?.name || '',
        company: buyerCompany?.name || retailer.company || '',
        mobile: buyerUser?.mobile || buyerCompany?.mobile || retailer.mobile || '',
        email: buyerUser?.email || buyerCompany?.email || retailer.email || '',
      };
    }
  }

  // 1) Invoice for just this packed quantity
  const invoice_no = await nextInvoiceNo(req.user.company_id);
  const invoice = await Invoice.create({
    company_id:     req.user.company_id,
    invoice_no,
    order_id:       order._id,
    order_no:       order.order_code || '',
    customer_id:    order.customer_id || null,
    customer_name:  order.customer_name || '',
    customer_phone: order.customer_mobile || '',
    customer_email: order.customer_email || '',
    billing_address:  order.delivery_address || order.location || '',
    shipping_address: order.delivery_address || order.location || '',
    invoice_date:   new Date(),
    items: [{
      product_id:   order.product_id || null,
      product_name: order.product_name || '',
      product_code: order.product_code || '',
      unit:         order.unit || 'Box',
      gst_percent:  gstPercent,
      qty:          packQty,
      rate,
      taxable_amount: amount,
      gst_amount:   gstAmount,
      total,
    }],
    subtotal:    amount,
    gst_amount:  gstAmount,
    grand_total: total,
    balance_due: total,
    payment_status: 'Unpaid',
    status:      'sent',
    // The Admin/seller who actually generated this invoice.
    created_by_name:    req.user?.name || '',
    created_by_person:  req.user?.name || '',
    created_by_company: sellerCompany?.name || '',
    created_by_mobile:  req.user?.mobile || sellerCompany?.mobile || '',
    created_by_email:   req.user?.email || sellerCompany?.email || '',
    created_by_type:    req.user?.role || 'Admin',
    // The retailer this order was routed through (shown after Customer).
    retailer_name:    retailer.name || '',
    retailer_company: retailer.company || '',
    retailer_mobile:  retailer.mobile || '',
    retailer_email:   retailer.email || '',
    remarks:     `Pack ${packNo} of order ${order.order_code} — ${packQty} ${order.unit || ''}`.trim(),
    created_by:  req.user._id,
  });

  // 2) Dispatch for this packed quantity
  const dispatch_code = await nextDispatchCode();
  let expected_delivery = req.body.expected_delivery || null;
  if (!expected_delivery && req.body.expected_delivery_days && req.body.dispatch_date) {
    const d = new Date(req.body.dispatch_date);
    d.setDate(d.getDate() + parseInt(req.body.expected_delivery_days, 10));
    expected_delivery = d;
  }
  const dispatch = await Dispatch.create({
    dispatch_code,
    company_id:       req.user.company_id,
    order_id:         order._id,
    enquiry_code:     order.enquiry_code || '',
    invoice_number:   invoice_no,
    invoice_id:       invoice._id,
    qty:              packQty,
    unit:             order.unit || '',
    customer_name:    order.customer_name || '',
    branch_name:      req.body.branch_name || order.branch_name || '',
    delivery_address: order.delivery_address || order.location || '',
    vehicle_number:   req.body.vehicle_number || '',
    driver_name:      req.body.driver_name || '',
    driver_mobile:    req.body.driver_mobile || '',
    transport_name:   req.body.transport_name || '',
    lr_number:        req.body.lr_number || '',
    dispatch_date:    req.body.dispatch_date || new Date(),
    expected_delivery_days: req.body.expected_delivery_days ? parseInt(req.body.expected_delivery_days, 10) : null,
    expected_delivery,
    status:     'Dispatched',
    created_by: req.user._id,
  });

  // 3) Update order counters + append package record + advance status
  const newDispatched = round2(alreadyShipped + packQty);
  const isFull = newDispatched >= orderedQty;
  const newStatus = isFull ? 'Dispatched' : 'Partially Dispatched';

  order.packed_qty     = round2((Number(order.packed_qty) || 0) + packQty);
  order.dispatched_qty = newDispatched;
  order.status         = newStatus;
  order.dispatch_id    = dispatch._id;        // latest dispatch
  order.invoice_number = invoice_no;          // latest invoice
  order.invoice_date   = new Date();
  order.packages.push({
    pack_no:        packNo,
    qty:            packQty,
    amount, gst_amount: gstAmount, total,
    invoice_id:     invoice._id,
    invoice_number: invoice_no,
    dispatch_id:    dispatch._id,
    dispatch_code,
    vehicle_number: dispatch.vehicle_number,
    transport_name: dispatch.transport_name,
    lr_number:      dispatch.lr_number,
    packed_by:      req.user._id,
    packed_by_name: req.user.name || '',
    packed_at:      new Date(),
  });
  order.status_history.push({
    status: newStatus,
    updated_by: req.user._id,
    updated_by_name: req.user.name || '',
    updated_by_role: req.user.role || '',
    remarks: `Packed ${packQty} ${order.unit || ''} (pack ${packNo}) — invoice ${invoice_no}, dispatch ${dispatch_code}. Remaining ${round2(orderedQty - newDispatched)}.`.trim(),
    timestamp: new Date(),
  });
  await order.save();

  // 4) Notify buyer (retailer) if marketplace order
  if (order.buyer_company_id && order.buyer_user_id) {
    await Notification.create({
      company_id: order.buyer_company_id,
      user_id: order.buyer_user_id,
      type: 'order_status',
      title: `Order ${order.order_code} — ${packQty} ${order.unit || ''} dispatched`,
      message: isFull
        ? `Your full order has been dispatched. Invoice ${invoice_no}.`
        : `${packQty} ${order.unit || ''} dispatched (${round2(orderedQty - newDispatched)} remaining). Invoice ${invoice_no}.`,
      reference_id: order._id,
    }).catch(() => {});
    notifyRetailer(order.buyer_user_id, {
      title: `Order ${order.order_code} Dispatched`,
      body: isFull
        ? `Your full order was dispatched. LR: ${dispatch.lr_number || '—'}`
        : `${packQty} ${order.unit || ''} dispatched, ${round2(orderedQty - newDispatched)} remaining.`,
      type: 'dispatch',
      referenceId: order._id,
    });
  }

  await Notification.create({
    company_id: req.user.company_id,
    type: 'dispatch',
    title: `Pack ${packNo} dispatched — ${order.order_code}`,
    message: `${packQty} ${order.unit || ''} packed & dispatched. Invoice ${invoice_no}, ${dispatch_code}.`,
    reference_id: order._id,
  }).catch(() => {});

  const populated = await Order.findById(order._id).populate('dispatch_id').lean();
  sendSuccess(res, { order: populated, invoice, dispatch }, isFull ? 'Order fully packed & dispatched.' : 'Partial pack dispatched.', 201);
}

module.exports = {
  listOrders, getTransitions, getOrder, getNextStatuses,
  createOrderFromEnquiry, createOrder,
  updateOrderStatus, updateOrder, deleteOrder, packOrder,
};
