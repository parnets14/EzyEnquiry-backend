/**
 * retailerDispatchController.js
 *
 * Retailer-side helpers for the Dispatch module.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * The shared `dispatchController` is scoped to `{ company_id: req.user.company_id }`
 * — i.e. dispatches the caller OWNS as the seller. That is the right scope for
 * the retailer's outbound shipments, but it gives the app no way to discover
 * WHICH of the retailer's orders are eligible to be dispatched.
 *
 * Without this endpoint the "New Dispatch" form would have nothing to put in its
 * order picker, so the module would be decorative. (The wholesaler app has the
 * same gap: its FAB opens DispatchEntry with no orderId, and the backend then
 * rejects the request with "order_id is required".)
 *
 * ── SCOPE NOTE ───────────────────────────────────────────────────────────────
 * `Order.company_id` is the SELLER's company; a retailer's marketplace
 * purchases carry the retailer in `buyer_company_id` instead (see
 * retailerMarketplaceController — orders are created with
 * `company_id: product.company_id._id` and `buyer_company_id: req.user.company_id`).
 *
 * So `{ company_id: req.user.company_id }` here means "orders raised against
 * products THIS retailer sells" — the ones the retailer is responsible for
 * shipping. The retailer's own INBOUND purchases are intentionally NOT listed:
 * those are dispatched by their seller and are already surfaced read-only via
 * GET /api/retailer/orders/:id/dispatches.
 */
const { sendSuccess } = require('../../utils/helpers')
const Order    = require('../../models/Marketplace Management/Order')
const Dispatch = require('../../models/Marketplace Management/Dispatch')

/**
 * Statuses `dispatchController.createDispatch` accepts. Kept in sync with the
 * `dispatchableStatuses` array there — a mismatch would let the picker offer an
 * order that the create call then rejects with a 422.
 */
const DISPATCHABLE_STATUSES = [
  'Accepted', 'Packing', 'Dispatched',
  // legacy backward-compat (same list as dispatchController.createDispatch)
  'Ready', 'Ready for Dispatch', 'Packing Completed',
  'Invoice Generated', 'Approved', 'Picking Completed', 'Packing Started',
]

// ─── GET /api/retailer/erp/dispatches/dispatchable-orders ────────────────────
/**
 * Orders this retailer can still raise a dispatch for.
 *
 * Two filters are applied:
 *   1. status must be dispatchable (mirrors createDispatch's own guard), and
 *   2. no Dispatch may already exist for the order — createDispatch returns 409
 *      "Dispatch already created for this order" otherwise, so offering it would
 *      only produce a guaranteed failure.
 *
 * `counts` is returned so the app can explain an empty list instead of showing a
 * blank screen.
 */
async function listDispatchableOrders(req, res) {
  const companyId = req.user.company_id

  const orders = await Order.find({ company_id: companyId })
    .select('order_code customer_name product_name qty unit rate total_amount status delivery_address created_at')
    .sort({ created_at: -1 })
    .limit(200)
    .lean()

  const orderIds = orders.map(o => o._id)
  const existing = orderIds.length
    ? await Dispatch.find({ order_id: { $in: orderIds } }).select('order_id').lean()
    : []
  const alreadyDispatched = new Set(existing.map(d => String(d.order_id)))

  const dispatchable = orders.filter(o =>
    DISPATCHABLE_STATUSES.includes(o.status) && !alreadyDispatched.has(String(o._id))
  )

  sendSuccess(res, {
    orders: dispatchable,
    counts: {
      own_orders:         orders.length,
      already_dispatched: alreadyDispatched.size,
      not_ready:          orders.filter(o => !DISPATCHABLE_STATUSES.includes(o.status)).length,
      dispatchable:       dispatchable.length,
    },
  })
}

module.exports = { listDispatchableOrders, DISPATCHABLE_STATUSES }
