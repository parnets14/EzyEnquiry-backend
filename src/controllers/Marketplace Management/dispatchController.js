/**
 * dispatchController.js
 *
 * Dispatch is the FINAL STOCK-OUT point.
 * When dispatch is created:  packed → dispatched, physical_stock ↓
 * When marked delivered:     Sale auto-created, Receivable auto-created
 *
 * Stock rule: physical_stock is only reduced here, never earlier.
 */

const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const Dispatch     = require('../../models/Marketplace Management/Dispatch');
const Order        = require('../../models/Marketplace Management/Order');
const Sale         = require('../../models/Finance Management/Sale');
const Receivable   = require('../../models/Finance Management/Receivable');
const Inventory    = require('../../models/Purchase & Inventory Management/Inventory');
const StockMovement = require('../../models/Purchase & Inventory Management/StockMovement');
const Notification = require('../../models/System Management/Notification');
const { notifyRetailer } = require('../../utils/pushHelper');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function nextDispatchCode() {
  const last = await Dispatch.findOne({ dispatch_code: /^DIS-/ }).sort({ dispatch_code: -1 }).lean();
  const num  = last?.dispatch_code ? parseInt(last.dispatch_code.split('-')[1], 10) : 0;
  return `DIS-${String(num + 1).padStart(4, '0')}`;
}

async function nextSaleCode() {
  const last = await Sale.findOne({ sale_code: /^SAL-/ }).sort({ sale_code: -1 }).lean();
  const num  = last?.sale_code ? parseInt(last.sale_code.split('-')[1], 10) : 0;
  return `SAL-${String(num + 1).padStart(4, '0')}`;
}

async function nextRcvCode() {
  const last = await Receivable.findOne({ rcv_code: /^RCV-/ }).sort({ rcv_code: -1 }).lean();
  const num  = last?.rcv_code ? parseInt(last.rcv_code.split('-')[1], 10) : 0;
  return `RCV-${String(num + 1).padStart(4, '0')}`;
}

/**
 * Core stock-out logic — called at dispatch creation.
 * Moves packed → dispatched and reduces physical_stock.
 * Falls back gracefully if packed_stock < qty (e.g. picking/packing was skipped).
 */
async function performStockOut(companyId, order, dispatchId, dispatchCode, userId) {
  if (!order.product_id || !order.qty) return;

  const filter = { company_id: companyId, product_id: order.product_id };
  if (order.warehouse_id) filter.warehouse_id = order.warehouse_id;

  const inv = await Inventory.findOne(filter);
  if (!inv) return; // no inventory record — skip silently

  const qty = parseFloat(order.qty) || 0;
  if (qty <= 0) return;

  // Determine how much to pull from each bucket
  const fromPacked    = Math.min(qty, inv.packed_stock   || 0);
  const remainder1    = qty - fromPacked;
  const fromPicking   = Math.min(remainder1, inv.picking_stock  || 0);
  const remainder2    = remainder1 - fromPicking;
  const fromReserved  = Math.min(remainder2, inv.reserved_stock || 0);
  const remainder3    = remainder2 - fromReserved;
  const fromAvailable = Math.min(remainder3, inv.available_stock || 0);

  const inc = {
    packed_stock:    -(fromPacked),
    picking_stock:   -(fromPicking),
    reserved_stock:  -(fromReserved),
    available_stock: -(fromAvailable),
    physical_stock:  -qty,   // ← ONLY reduction of physical_stock
    current_stock:   -qty,   // legacy mirror
    dispatched_qty:  +qty,
    stock_out:       +qty,   // legacy counter
  };

  const prevPhysical = inv.physical_stock || 0;
  await Inventory.findByIdAndUpdate(inv._id, { $inc: inc });

  // Log stock movement
  await StockMovement.create({
    company_id:     companyId,
    product_id:     order.product_id,
    product_name:   order.product_name || '',
    product_code:   order.product_code || '',
    warehouse_id:   order.warehouse_id || inv.warehouse_id || null,
    warehouse_name: '',
    movement_type:  'Stock Out',
    quantity:       qty,
    previous_stock: prevPhysical,
    new_stock:      prevPhysical - qty,
    unit:           order.unit || '',
    reference_type: 'Sale',
    reference_id:   dispatchId?.toString() || '',
    invoice_number: dispatchCode || '',
    notes:          `Dispatched — ${dispatchCode} / Order ${order.order_code || ''}`,
    created_by:     userId,
    movement_date:  new Date(),
  }).catch(e => console.error('[StockMovement] dispatch log failed:', e.message));
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/dispatches
// ─────────────────────────────────────────────────────────────────────────────
async function listDispatches(req, res) {
  const { status, search, page = 1, limit = 100 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = { company_id: req.user.company_id };
  if (status && status !== 'All') query.status = status;
  if (search) {
    query.$or = [
      { customer_name:  { $regex: search, $options: 'i' } },
      { dispatch_code:  { $regex: search, $options: 'i' } },
      { invoice_number: { $regex: search, $options: 'i' } },
      { lr_number:      { $regex: search, $options: 'i' } },
      { vehicle_number: { $regex: search, $options: 'i' } },
    ];
  }

  const [total, dispatches] = await Promise.all([
    Dispatch.countDocuments(query),
    Dispatch.find(query)
      .populate('order_id', 'order_code product_name product_id qty total_amount branch_name enquiry_code invoice_number delivery_address location warehouse_id')
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(parseInt(limit))
      .lean(),
  ]);

  sendSuccess(res, { dispatches, pagination: paginate(total, parseInt(page), parseInt(limit)) });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/dispatches/:id
// ─────────────────────────────────────────────────────────────────────────────
async function getDispatch(req, res) {
  const dispatch = await Dispatch.findOne({ _id: req.params.id, company_id: req.user.company_id })
    .populate('order_id', 'order_code customer_name product_name product_id qty rate total_amount delivery_address location enquiry_code invoice_number warehouse_id')
    .lean();
  if (!dispatch) return sendError(res, 'Dispatch not found.', 404);

  // Attach linked sale if exists
  const sale = await Sale.findOne({ dispatch_id: dispatch._id })
    .select('sale_code payment_status grand_total paid_amount outstanding')
    .lean();

  sendSuccess(res, { ...dispatch, sale: sale || null });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/dispatches
// ─────────────────────────────────────────────────────────────────────────────
async function createDispatch(req, res) {
  const { order_id } = req.body;
  if (!order_id) return sendError(res, 'order_id is required.');

  const order = await Order.findOne({ _id: order_id, company_id: req.user.company_id }).lean();
  if (!order) return sendError(res, 'Order not found.', 404);

  // Only allow dispatch when order is Ready for Dispatch (strict) or Packing Completed (relaxed)
  const dispatchableStatuses = ['Ready for Dispatch', 'Packing Completed', 'Invoice Generated', 'Approved', 'Picking Completed', 'Packing Started'];
  if (!dispatchableStatuses.includes(order.status)) {
    return sendError(res, `Order status must be "Ready for Dispatch". Current: "${order.status}"`, 422);
  }

  // Prevent duplicate dispatch
  const existing = await Dispatch.findOne({ order_id }).select('_id dispatch_code status').lean();
  if (existing) return sendError(res, 'Dispatch already created for this order.', 409);

  const dispatch_code = await nextDispatchCode();

  // Auto-calc expected delivery date
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
    order_id:         order._id,
    customer_name:    order.customer_name,
    branch_name:      req.body.branch_name    || order.branch_name    || '',
    enquiry_code:     order.enquiry_code      || '',
    invoice_number:   req.body.invoice_number || order.invoice_number || '',
    delivery_address: req.body.delivery_address || order.delivery_address || order.location || '',
    expected_delivery,
    status:     'Dispatched',
    created_by: req.user._id,
  });

  // ── STOCK OUT: packed → dispatched, physical_stock ↓ ────────────────────
  await performStockOut(req.user.company_id, order, dispatch._id, dispatch_code, req.user._id);

  // Update order → Dispatched
  await Order.findByIdAndUpdate(order_id, {
    dispatch_id: dispatch._id,
    status:      'Dispatched',
    $push: {
      status_history: {
        status:          'Dispatched',
        updated_by:      req.user._id,
        updated_by_name: req.user.name || 'Dispatch',
        remarks:         `Dispatch ${dispatch_code} created`,
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
  }).catch(() => {});

  // Push notification to retailer buyer if this is a marketplace order
  if (order.buyer_user_id) {
    notifyRetailer(order.buyer_user_id, {
      title: `Order ${order.order_code} Dispatched!`,
      body: `Your order has been dispatched via ${req.body.transport_name || 'transport'}. LR: ${req.body.lr_number || '—'}`,
      type: 'dispatch',
      referenceId: order._id,
    });
  }

  sendSuccess(res, dispatch, 'Dispatch created.', 201);
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/dispatches/:id/intransit
// ─────────────────────────────────────────────────────────────────────────────
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
          updated_by:      req.user._id,
          updated_by_name: req.user.name || 'Dispatch',
          remarks:         'Shipment in transit',
          timestamp:       new Date(),
        },
      },
    });
  }
  sendSuccess(res, dispatch, 'Marked as In Transit.');
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/dispatches/:id/deliver
// Auto-creates Sale + Receivable on delivery
// ─────────────────────────────────────────────────────────────────────────────
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
    // Update order status
    await Order.findByIdAndUpdate(order._id, {
      status:         'Delivered',
      delivered_date,
      $push: {
        status_history: {
          status:          'Delivered',
          updated_by:      req.user._id,
          updated_by_name: req.user.name || 'Delivery',
          remarks:         req.body.pod_remarks || 'Delivered',
          timestamp:       new Date(),
        },
      },
    });

    // Auto-create Sale if not already done (idempotent)
    const existingSale = await Sale.findOne({ order_id: order._id }).lean();
    if (!existingSale) {
      // Lookup COGS from inventory
      let cogs = 0;
      if (order.product_id) {
        const invFilter = { company_id: req.user.company_id, product_id: order.product_id };
        if (order.warehouse_id) invFilter.warehouse_id = order.warehouse_id;
        const inv = await Inventory.findOne(invFilter).select('purchase_rate').lean();
        cogs = (inv?.purchase_rate || 0) * (order.qty || 0);
      }

      const grandTotal = order.total_amount || 0;

      const sale = await Sale.create({
        sale_code:      await nextSaleCode(),
        company_id:     req.user.company_id,
        order_id:       order._id,
        dispatch_id:    dispatch._id,
        customer_id:    order.customer_id   || null,
        customer_name:  order.customer_name,
        product_id:     order.product_id    || null,
        product_code:   order.product_code  || '',
        product_name:   order.product_name  || '',
        warehouse_id:   order.warehouse_id  || null,
        qty:            order.qty,
        rate:           order.rate,
        amount:         order.amount,
        gst_percent:    order.gst_percent   || 18,
        gst_amount:     order.gst_amount    || 0,
        total_amount:   grandTotal,
        discount:       0,
        grand_total:    grandTotal,
        cogs,
        invoice_number: order.invoice_number || '',
        invoice_date:   order.invoice_date   || null,
        sale_status:    'Delivered',
        payment_status: 'Pending',
        outstanding:    grandTotal,
        paid_amount:    0,
        sale_date:      delivered_date,
        created_by:     req.user._id,
      });

      // Auto-create Receivable
      await Receivable.create({
        rcv_code:       await nextRcvCode(),
        company_id:     req.user.company_id,
        customer_id:    order.customer_id   || null,
        customer_name:  order.customer_name,
        order_id:       order._id,
        sale_id:        sale._id,
        invoice_amount: grandTotal,
        received:       0,
        outstanding:    grandTotal,
        status:         'Pending',
      }).catch(() => {}); // non-fatal
    }

    await Notification.create({
      company_id:   req.user.company_id,
      type:         'delivery',
      title:        `Order ${order.order_code} Delivered`,
      message:      `Delivered to ${order.customer_name}. Sale & receivable auto-created.`,
      reference_id: order._id,
    }).catch(() => {});

    // Push notification to retailer buyer
    if (order.buyer_user_id) {
      notifyRetailer(order.buyer_user_id, {
        title: `Order ${order.order_code} Delivered!`,
        body: `Your order has been delivered successfully.`,
        type: 'delivery',
        referenceId: order._id,
      });
    }
  }

  sendSuccess(res, dispatch, 'Marked as Delivered. Sale auto-created.');
}

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/dispatches/:id
// ─────────────────────────────────────────────────────────────────────────────
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

  const upd = {};
  if (notes              !== undefined) upd.notes              = notes;
  if (vehicle_number     !== undefined) upd.vehicle_number     = vehicle_number;
  if (driver_name        !== undefined) upd.driver_name        = driver_name;
  if (driver_mobile      !== undefined) upd.driver_mobile      = driver_mobile;
  if (transport_name     !== undefined) upd.transport_name     = transport_name;
  if (lr_number          !== undefined) upd.lr_number          = lr_number;
  if (branch_name        !== undefined) upd.branch_name        = branch_name;
  if (delivery_address   !== undefined) upd.delivery_address   = delivery_address;
  if (expected_delivery_days !== undefined) upd.expected_delivery_days = parseInt(expected_delivery_days) || null;
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
