/**
 * retailerOrderController.js
 *
 * SELLER-SIDE order fulfilment for the Retailer app.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * `retailerRoutes.js` exposes orders through `retailerMarketplaceController`,
 * which is written from the BUYER's point of view: list my purchases, cancel,
 * track, read the seller's dispatches. A retailer that sells its OWN products
 * (or resells) had no way to act as the product owner — no way to accept an
 * incoming order, and no way to pack it.
 *
 * ── SCOPE (read this before adding a query here) ─────────────────────────────
 * `Order.company_id` is the SELLER's company. A retailer's marketplace PURCHASE
 * carries the retailer in `buyer_company_id` instead (see
 * retailerMarketplaceController — orders are created with
 * `company_id: product.company_id._id`, `buyer_company_id: req.user.company_id`).
 *
 * So every query here is scoped `{ company_id: req.user.company_id }`, which
 * means "orders raised against products THIS retailer sells". A retailer can
 * therefore never accept, reject or pack an order it placed as a buyer — those
 * resolve to 404. That scoping is the whole security model of this file; do not
 * widen it to `$or` on buyer ids.
 *
 * ── PARTIAL PACKING ──────────────────────────────────────────────────────────
 * Packing is NOT implemented here. `orderController.packOrder` already does the
 * whole job for a partial quantity — invoice for just that qty, dispatch with
 * vehicle details, stock-out, sale + receivable, and it appends to
 * `order.packages[]`. It is scoped `{ _id, company_id: req.user.company_id }`,
 * i.e. the same seller scope, so the retailer route simply re-exports it.
 * Re-implementing it here would duplicate a 330-line financial path.
 */
const Order = require('../../models/Marketplace Management/Order')
const Dispatch = require('../../models/Marketplace Management/Dispatch')
const { sendSuccess, sendError, paginate } = require('../../utils/helpers')
const {
  reserveStockForOrder,
  releaseReserveForOrder,
} = require('../Purchase & Inventory Management/inventoryController')

/**
 * The only transitions a SELLER may drive from the app.
 *
 * These mirror the canonical graph in `orderController.VALID_TRANSITIONS`
 * (`New → Accepted → Packing → Dispatched → Out for Delivery → Delivered`,
 * with `Cancelled` reachable from New / Accepted / Packing) — the app just
 * exposes them under action names.
 *
 * Deliberately NOT included: anything that jumps straight to 'Dispatched'.
 * Dispatch must go through `packOrder`, which raises the invoice, the stock-out
 * and the dispatch record together. `deliver` exists only as a fallback for an
 * order the buyer never confirmed with a delivery OTP.
 *
 * ── STOCK BUCKETS ────────────────────────────────────────────────────────────
 * `reserve` / `release` below are NOT cosmetic. `packOrder` drains inventory in
 * the order packed → picking → reserved → available, so:
 *   • `accept` must move available → reserved, or two orders can oversell the
 *     same units and the pack step silently eats into available stock;
 *   • `cancel`/`reject` of an ACCEPTED order must release that reserve, or the
 *     units stay reserved forever and are stranded from sale.
 * This is the same contract `orderController.updateOrderStatus` implements.
 */
const SELLER_ACTIONS = {
  accept:  { from: ['New'],                 to: 'Accepted',  reserve: true },
  reject:  { from: ['New'],                 to: 'Cancelled' },
  cancel:  { from: ['Accepted', 'Packing'], to: 'Cancelled', release: true },
  packing: { from: ['Accepted'],            to: 'Packing' },
  deliver: { from: ['Dispatched', 'Out for Delivery'], to: 'Delivered' },
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

/** Ordered / dispatched / remaining — the numbers the pack form is built on. */
function progressOf(order) {
  const ordered = Number(order.qty) || 0
  const dispatched = Number(order.dispatched_qty) || 0
  const remaining = Math.max(0, round2(ordered - dispatched))
  const packages = Array.isArray(order.packages) ? order.packages : []
  return {
    ordered_qty: ordered,
    dispatched_qty: dispatched,
    remaining_qty: remaining,
    pack_count: packages.length,
    // Something has gone out but not everything — the "send 50 of 100" case.
    is_partial: dispatched > 0 && remaining > 0,
    is_complete: ordered > 0 && remaining <= 0,
  }
}

const SUMMARY_SELECT =
  'order_code customer_name customer_mobile delivery_address branch_name ' +
  'product_id product_code product_name unit qty rate amount gst_percent gst_amount ' +
  'total_amount status packed_qty dispatched_qty packages expected_delivery ' +
  'delivered_date order_date due_date created_at updated_at enquiry_code notes'

// ─── GET /api/retailer/erp/orders ────────────────────────────────────────────
/**
 * Orders this retailer is the SELLER for.
 * Query: { status, search, page, limit }
 */
async function listSellerOrders(req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20))

  const scope = { company_id: req.user.company_id }
  const query = { ...scope }

  if (req.query.status && req.query.status !== 'All') query.status = String(req.query.status)

  const search = String(req.query.search || '').trim()
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    query.$or = [
      { order_code: rx }, { customer_name: rx },
      { product_name: rx }, { product_code: rx }, { enquiry_code: rx },
    ]
  }

  const [total, orders, grouped] = await Promise.all([
    Order.countDocuments(query),
    Order.find(query).select(SUMMARY_SELECT)
      .sort({ created_at: -1 })
      .skip((page - 1) * limit).limit(limit).lean(),
    // Status tallies across the WHOLE scope (not the filtered page) so the
    // filter chips keep stable counts while the user narrows the list.
    Order.aggregate([
      { $match: scope },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ])

  const counts = { All: 0 }
  grouped.forEach(g => { counts[g._id] = g.count; counts.All += g.count })

  sendSuccess(res, {
    orders: orders.map(o => ({ ...o, progress: progressOf(o) })),
    pagination: paginate(total, page, limit),
    counts,
  })
}

// ─── GET /api/retailer/erp/orders/:id ────────────────────────────────────────
/** One seller-side order, with its pack history and raised dispatches. */
async function getSellerOrder(req, res) {
  const order = await Order.findOne({ _id: req.params.id, company_id: req.user.company_id })
    .select(SUMMARY_SELECT)
    .lean()
  if (!order) return sendError(res, 'Order not found.', 404)

  const dispatches = await Dispatch.find({ order_id: order._id })
    .select('dispatch_code qty unit status vehicle_number driver_name driver_mobile transport_name lr_number dispatch_date expected_delivery delivered_date invoice_number')
    .sort({ created_at: 1 })
    .lean()

  sendSuccess(res, { order: { ...order, progress: progressOf(order) }, dispatches })
}

// ─── PATCH /api/retailer/erp/orders/:id/status ───────────────────────────────
/** Body: { action: 'accept' | 'reject' | 'cancel' | 'packing' | 'deliver', remarks? } */
async function updateSellerOrderStatus(req, res) {
  const action = String(req.body.action || '').trim()
  const rule = SELLER_ACTIONS[action]
  if (!rule) {
    return sendError(res, `Unknown action "${action}". Use one of: ${Object.keys(SELLER_ACTIONS).join(', ')}.`, 400)
  }

  const order = await Order.findOne({ _id: req.params.id, company_id: req.user.company_id })
  if (!order) return sendError(res, 'Order not found.', 404)

  if (!rule.from.includes(order.status)) {
    return sendError(
      res,
      `Cannot ${action} an order that is "${order.status}". Expected: ${rule.from.join(' or ')}.`,
      409,
    )
  }

  // An order that has already shipped cannot be unwound — the stock is gone and
  // the invoice is raised. Cancelling it here would strand both.
  if ((action === 'reject' || action === 'cancel') && (Number(order.dispatched_qty) || 0) > 0) {
    return sendError(res, 'This order already has dispatches and cannot be cancelled.', 409)
  }

  // ── PRE-COMMIT: reserve stock BEFORE accepting ─────────────────────────────
  // Mirrors orderController.updateOrderStatus. If stock is insufficient we must
  // NOT accept — otherwise the order is accepted against inventory that does not
  // exist and the pack step fails later, after the buyer was told "accepted".
  if (rule.reserve) {
    const reserved = await reserveStockForOrder({
      companyId:   req.user.company_id,
      productId:   order.product_id,
      warehouseId: order.warehouse_id || null,
      qty:         order.qty,
      orderId:     order._id,
      orderCode:   order.order_code,
      userId:      req.user._id,
    })
    if (!reserved.ok) {
      return sendError(res, `Order could not be accepted — ${reserved.error || 'insufficient stock'}.`, 422)
    }
  }

  order.status = rule.to
  order.status_history.push({
    status: rule.to,
    updated_by: req.user._id,
    updated_by_name: req.user?.name || '',
    updated_by_role: req.user?.role || 'Retailer',
    remarks: String(req.body.remarks || '').trim() || `${action} by seller`,
    timestamp: new Date(),
  })
  await order.save()

  // ── POST-COMMIT: hand the reserved units back to available ─────────────────
  // Non-fatal on purpose: the order is already cancelled, and failing the request
  // here would leave the client thinking the cancel did not happen. A failed
  // release is logged for reconciliation instead.
  if (rule.release) {
    const released = await releaseReserveForOrder({
      companyId:   req.user.company_id,
      productId:   order.product_id,
      warehouseId: order.warehouse_id || null,
      qty:         order.qty,
      orderId:     order._id,
      orderCode:   order.order_code,
      userId:      req.user._id,
    })
    if (!released.ok) {
      console.warn(`[updateSellerOrderStatus] release on cancel failed for ${order.order_code}:`, released.error)
    }
  }

  sendSuccess(res, { order: { ...order.toObject(), progress: progressOf(order) } }, `Order ${rule.to.toLowerCase()}.`)
}

module.exports = { listSellerOrders, getSellerOrder, updateSellerOrderStatus, progressOf, SELLER_ACTIONS }
