/**
 * inventoryController.js
 *
 * Stock bucket lifecycle — quantities move between buckets, never double-deducted.
 *
 *   physical_stock  = available + reserved + picking + packed + blocked
 *                     Reduced ONLY when dispatch is confirmed (stock-out).
 *   available_stock = sellable stock
 *   reserved_stock  = locked for a confirmed order (available ↓, reserved ↑)
 *   picking_stock   = warehouse picking in progress (reserved ↓, picking ↑)
 *   packed_stock    = packed, awaiting dispatch (picking ↓, packed ↑)
 *   blocked_stock   = damaged / QC hold (available ↓, blocked ↑)
 *   dispatched_qty  = cumulative counter (packed ↓, physical_stock ↓, dispatched_qty ↑)
 */

const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const Inventory     = require('../../models/Purchase & Inventory Management/Inventory');
const StockMovement = require('../../models/Purchase & Inventory Management/StockMovement');
const Product       = require('../../models/Product Management/Product');
const User          = require('../../models/User Management/User');
const Notification  = require('../../models/System Management/Notification');
const { notifyRetailer } = require('../../utils/pushHelper');
const mongoose      = require('mongoose');

/**
 * Notify the company owner about a low-stock / out-of-stock event.
 * Creates an in-app Notification and fires a best-effort push. Non-blocking.
 * Dedup: skip if an unread notification for the same (company, product, kind)
 * exists in the last 24 hours.
 */
async function notifyStockOwner(companyId, productId, kind, threshold) {
  const Notification = require('../../models/System Management/Notification');
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentDup = await Notification.findOne({
    company_id: companyId,
    reference_id: productId,
    type: kind === 'out_of_stock' ? 'out_of_stock' : 'low_stock',
    is_read: false,
    created_at: { $gte: oneDayAgo },
  }).select('_id').lean().catch(() => null);
  if (recentDup) return;

  const [product, owner] = await Promise.all([
    Product.findById(productId).select('name code').lean(),
    User.findOne({ company_id: companyId, role: { $in: ['Company Owner', 'Wholesaler', 'Retailer'] } }).select('_id').lean(),
  ]);
  const pname = product?.name || 'A product';
  const isOut = kind === 'out_of_stock';
  const backIn = kind === 'back_in_stock';
  const notifType = backIn ? 'back_in_stock' : (isOut ? 'out_of_stock' : 'low_stock');
  const title = backIn ? 'Back In Stock' : (isOut ? 'Out of Stock' : 'Low Stock Alert');
  const message = backIn
    ? `"${pname}" is back in stock.`
    : isOut
      ? `"${pname}" is now out of stock. Restock soon.`
      : `"${pname}" is running low (at or below ${threshold ?? 50} units).`;

  await Notification.create({
    company_id: companyId,
    user_id:    owner ? owner._id : null,
    type:       notifType,
    title,
    message,
    reference_id: productId,
    is_read:    false,
  }).catch(() => {});

  if (owner) notifyRetailer(owner._id, { title, body: message, type: notifType, referenceId: productId }).catch(() => {});
}

/**
 * Unified stock-level change detector.
 * Fires the appropriate alerts when a stock movement crosses a threshold.
 *
 * Directions handled:
 *   UP (prevAvail <= 0, newAvail > 0)                      → Back In Stock
 *   DOWN (prevAvail > 0, newAvail <= 0)                    → Out of Stock
 *   DOWN (prevAvail > threshold, newAvail <= threshold)    → Low Stock
 */
async function checkAndNotifyStockLevels(companyId, productId, prevAvailable, newAvailable, threshold) {
  try {
    if (!companyId || !productId) return;
    const prevAvail = Number(prevAvailable) || 0;
    const newAvail  = Number(newAvailable)  || 0;
    const limit     = Number(threshold);
    const safeLimit = Number.isFinite(limit) && limit >= 0 ? limit : 50;

    if (prevAvail <= 0 && newAvail > 0) {
      await notifyStockOwner(companyId, productId, 'back_in_stock', safeLimit);
      return;
    }
    if (prevAvail > 0 && newAvail <= 0) {
      await notifyStockOwner(companyId, productId, 'out_of_stock', safeLimit);
      return;
    }
    if (newAvail > 0 && safeLimit > 0 && prevAvail > safeLimit && newAvail <= safeLimit) {
      await notifyStockOwner(companyId, productId, 'low_stock', safeLimit);
    }
  } catch (e) {
    console.error('[checkAndNotifyStockLevels] failed gracefully:', e.message);
  }
}

// ── Pure programmatic helpers (no req/res) for Order / Dispatch controllers ─

/**
 * Move available → reserved when an order transitions to Accepted.
 * Returns { ok: true, inventory } on success or { ok: false, error }.
 * Never throws — callers rely on returned status.
 */
async function reserveStockForOrder({ companyId, productId, warehouseId, qty, orderId, orderCode, userId }) {
  try {
    const absQty = Math.abs(parseFloat(qty));
    if (!absQty || !productId) return { ok: false, error: 'Missing product/qty' };

    const filter = { company_id: companyId, product_id: productId };
    if (warehouseId) filter.warehouse_id = warehouseId;

    const inv = await Inventory.findOne(filter).sort({ available_stock: -1 }).exec();
    if (!inv) return { ok: false, error: 'No inventory record found' };
    if ((inv.available_stock || 0) < absQty) {
      return { ok: false, error: `Insufficient stock. Available: ${inv.available_stock || 0}` };
    }

    const prevAvailable = inv.available_stock || 0;
    const prevPhysical  = inv.physical_stock  || 0;

    const updated = await Inventory.findByIdAndUpdate(inv._id, {
      $inc: { available_stock: -absQty, reserved_stock: absQty },
    }, { new: true }).lean();

    await logMovement({
      company_id:     companyId,
      product_id:     productId,
      warehouse_id:   warehouseId || inv.warehouse_id || null,
      movement_type:  'Stock Out',
      quantity:       absQty,
      previous_stock: prevPhysical,
      new_stock:      updated.physical_stock || prevPhysical,
      unit:           '',
      reference_type: 'Order',
      reference_id:   orderId ? String(orderId) : '',
      notes:          `Reserved for order ${orderCode || orderId || ''}`,
      created_by:     userId || null,
      movement_date:  new Date(),
    });

    await checkAndNotifyStockLevels(
      companyId, productId,
      prevAvailable, updated.available_stock,
      updated.low_stock_alert
    );

    return { ok: true, inventory: updated };
  } catch (e) {
    console.error('[reserveStockForOrder] failed:', e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Release reserved (or picking/packed) stock back to available on order cancel.
 */
async function releaseReserveForOrder({ companyId, productId, warehouseId, qty, orderId, orderCode, userId }) {
  try {
    const absQty = Math.abs(parseFloat(qty));
    if (!absQty || !productId) return { ok: false, error: 'Missing product/qty' };

    const filter = { company_id: companyId, product_id: productId };
    if (warehouseId) filter.warehouse_id = warehouseId;

    const inv = await Inventory.findOne(filter).sort({ reserved_stock: -1 }).exec();
    if (!inv) return { ok: false, error: 'No inventory record found' };

    const releasable = (inv.reserved_stock || 0) + (inv.picking_stock || 0) + (inv.packed_stock || 0);
    const actual     = Math.min(absQty, releasable);
    if (actual <= 0) return { ok: true, inventory: inv.toObject ? inv.toObject() : inv };

    let remaining = actual;
    const inc = {};

    if ((inv.packed_stock || 0) > 0 && remaining > 0) {
      const fromPacked = Math.min(remaining, inv.packed_stock);
      inc.packed_stock  = -fromPacked;
      remaining        -= fromPacked;
    }
    if ((inv.picking_stock || 0) > 0 && remaining > 0) {
      const fromPicking = Math.min(remaining, inv.picking_stock);
      inc.picking_stock = -fromPicking;
      remaining        -= fromPicking;
    }
    if ((inv.reserved_stock || 0) > 0 && remaining > 0) {
      const fromReserved = Math.min(remaining, inv.reserved_stock);
      inc.reserved_stock = -fromReserved;
      remaining         -= fromReserved;
    }
    inc.available_stock = actual;

    const prevAvailable = inv.available_stock || 0;
    const prevPhysical  = inv.physical_stock  || 0;

    const updated = await Inventory.findByIdAndUpdate(inv._id, { $inc: inc }, { new: true }).lean();

    await logMovement({
      company_id:     companyId,
      product_id:     productId,
      warehouse_id:   warehouseId || inv.warehouse_id || null,
      movement_type:  'Reversal',
      quantity:       actual,
      previous_stock: prevPhysical,
      new_stock:      updated.physical_stock || prevPhysical,
      unit:           '',
      reference_type: 'Order',
      reference_id:   orderId ? String(orderId) : '',
      notes:          `Reserved stock released — order ${orderCode || orderId || ''} cancelled`,
      created_by:     userId || null,
      movement_date:  new Date(),
    });

    await checkAndNotifyStockLevels(
      companyId, productId,
      prevAvailable, updated.available_stock,
      updated.low_stock_alert
    );

    return { ok: true, inventory: updated };
  } catch (e) {
    console.error('[releaseReserveForOrder] failed:', e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Deduct stock directly after a confirmed stock-out (dispatch / sale).
 * Also runs threshold notifications.
 */
async function confirmDispatchStockOut({ companyId, order, dispatchId, dispatchCode, userId }) {
  if (!order?.product_id || !order?.qty) return { ok: true };

  const qty = Math.abs(parseFloat(order.qty)) || 0;
  if (qty <= 0) return { ok: true };

  const filter = { company_id: companyId, product_id: order.product_id };
  if (order.warehouse_id) filter.warehouse_id = order.warehouse_id;

  const inv = await Inventory.findOne(filter);
  if (!inv) return { ok: true };

  // If stock was deducted at booking (legacy path), only advance counter.
  if (order.stock_deducted) {
    await Inventory.findByIdAndUpdate(inv._id, { $inc: { dispatched_qty: +qty } });
    return { ok: true };
  }

  const fromPacked    = Math.min(qty, inv.packed_stock    || 0);
  const rem1          = qty - fromPacked;
  const fromPicking   = Math.min(rem1, inv.picking_stock   || 0);
  const rem2          = rem1 - fromPicking;
  const fromReserved  = Math.min(rem2, inv.reserved_stock  || 0);
  const rem3          = rem2 - fromReserved;
  const fromAvailable = Math.min(rem3, inv.available_stock || 0);

  const inc = {
    packed_stock:    -fromPacked,
    picking_stock:   -fromPicking,
    reserved_stock:  -fromReserved,
    available_stock: -fromAvailable,
    physical_stock:  -qty,
    current_stock:   -qty,
    dispatched_qty:  +qty,
    stock_out:       +qty,
  };

  const prevAvailable = inv.available_stock || 0;
  const prevPhysical  = inv.physical_stock  || 0;

  const updated = await Inventory.findByIdAndUpdate(inv._id, { $inc: inc }, { new: true }).lean();

  await logMovement({
    company_id:     companyId,
    product_id:     order.product_id,
    product_name:   order.product_name || '',
    product_code:   order.product_code || '',
    warehouse_id:   order.warehouse_id || inv.warehouse_id || null,
    movement_type:  'Stock Out',
    quantity:       qty,
    previous_stock: prevPhysical,
    new_stock:      updated.physical_stock || prevPhysical - qty,
    unit:           order.unit || '',
    reference_type: 'Sale',
    reference_id:   dispatchId ? String(dispatchId) : '',
    invoice_number: dispatchCode || '',
    notes:          `Dispatched — ${dispatchCode || ''} / Order ${order.order_code || ''}`,
    created_by:     userId || null,
    movement_date:  new Date(),
  });

  await checkAndNotifyStockLevels(
    companyId, order.product_id,
    prevAvailable, updated.available_stock,
    updated.low_stock_alert
  );

  return { ok: true, updated };
}

// ── Ensure Warehouse is registered before populate ──────────────────────────
require('../../models/Purchase & Inventory Management/Warehouse');

/**
 * Deduct an order's quantity from inventory at BOOKING time (order creation),
 * so available stock drops immediately across all apps. Idempotent-safe by the
 * caller via the order's `stock_deducted` flag.
 *
 * Reduces available_stock, physical_stock (and legacy current_stock), bumps the
 * stock_out counter, and logs a StockMovement. Never throws — inventory issues
 * must not block order creation. Returns true if a deduction happened.
 *
 * @param {Object} order  the created order document (needs product_id, qty, etc.)
 * @param {ObjectId} userId  the acting user (for the movement log)
 */
async function deductStockForOrder(order, userId) {
  try {
    if (!order?.product_id || !order?.qty) return false;
    const qty = Math.abs(parseFloat(order.qty)) || 0;
    if (qty <= 0) return false;

    // Find the inventory record for this product. Prefer the order's warehouse
    // when it names one, but fall back to any record for the product (e.g. the
    // "Unassigned" record) so stock still deducts when warehouses don't line up.
    let inv = null;
    if (order.warehouse_id) {
      inv = await Inventory.findOne({ product_id: order.product_id, warehouse_id: order.warehouse_id });
    }
    if (!inv) {
      inv = await Inventory.findOne({ product_id: order.product_id }).sort({ available_stock: -1 });
    }
    if (!inv) return false; // no inventory record for this product — skip silently

    const prevPhysical = inv.physical_stock || 0;
    const fromAvailable = Math.min(qty, inv.available_stock || 0);

    await Inventory.findByIdAndUpdate(inv._id, {
      $inc: {
        available_stock: -fromAvailable,
        physical_stock:  -qty,
        current_stock:   -qty,   // legacy mirror
        stock_out:       +qty,   // legacy counter
      },
    });

    await StockMovement.create({
      company_id:     inv.company_id,
      product_id:     order.product_id,
      product_name:   order.product_name || '',
      product_code:   order.product_code || '',
      warehouse_id:   order.warehouse_id || inv.warehouse_id || null,
      movement_type:  'Stock Out',
      quantity:       qty,
      previous_stock: prevPhysical,
      new_stock:      prevPhysical - qty,
      unit:           order.unit || '',
      reference_type: 'Order',
      reference_id:   order._id?.toString() || '',
      notes:          `Booked — Order ${order.order_code || ''}`,
      created_by:     userId || order.created_by || null,
      movement_date:  new Date(),
    }).catch(e => console.error('[StockMovement] order booking log failed:', e.message));

    return true;
  } catch (e) {
    console.error('[deductStockForOrder] failed gracefully:', e.message);
    return false;
  }
}

/**
 * Restore an order's quantity back to inventory (on cancellation), reversing a
 * prior booking deduction. Never throws. Returns true if a restore happened.
 */
async function restoreStockForOrder(order, userId) {
  try {
    if (!order?.product_id || !order?.qty) return false;
    const qty = Math.abs(parseFloat(order.qty)) || 0;
    if (qty <= 0) return false;

    let inv = null;
    if (order.warehouse_id) {
      inv = await Inventory.findOne({ product_id: order.product_id, warehouse_id: order.warehouse_id });
    }
    if (!inv) {
      inv = await Inventory.findOne({ product_id: order.product_id }).sort({ available_stock: -1 });
    }
    if (!inv) return false;

    const prevPhysical = inv.physical_stock || 0;
    await Inventory.findByIdAndUpdate(inv._id, {
      $inc: {
        available_stock: +qty,
        physical_stock:  +qty,
        current_stock:   +qty,
        stock_in:        +qty,
      },
    });

    await StockMovement.create({
      company_id:     inv.company_id,
      product_id:     order.product_id,
      product_name:   order.product_name || '',
      product_code:   order.product_code || '',
      warehouse_id:   order.warehouse_id || inv.warehouse_id || null,
      movement_type:  'Reversal',
      quantity:       qty,
      previous_stock: prevPhysical,
      new_stock:      prevPhysical + qty,
      unit:           order.unit || '',
      reference_type: 'Order',
      reference_id:   order._id?.toString() || '',
      notes:          `Order ${order.order_code || ''} cancelled — stock returned`,
      created_by:     userId || null,
      movement_date:  new Date(),
    }).catch(e => console.error('[StockMovement] order cancel log failed:', e.message));

    return true;
  } catch (e) {
    console.error('[restoreStockForOrder] failed gracefully:', e.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Resolve who created a product — mirrors the CRM "ADDED BY" badge logic so
 *  Inventory shows the same source as Product Management. */
function resolveCreatorType(product) {
  if (!product) return '';
  if (product.created_by_type) return product.created_by_type;
  const role = String(product.created_by?.role || '').toLowerCase();
  if (role.includes('retail')) return 'Retailer';
  if (role.includes('whole'))  return 'Wholesaler';
  if (role.includes('admin'))  return 'Admin';
  const biz = String(product.company_id?.biz_type || '').toLowerCase();
  if (biz.includes('retail')) return 'Retailer';
  if (biz.includes('whole'))  return 'Wholesaler';
  if (String(product.code || '').toUpperCase().startsWith('RPD-')) return 'Retailer';
  return '';
}

/** Populate and flatten an inventory document */
function flattenInventory(d) {
  // Backward-compat: old records only have current_stock set (pre-bucket migration).
  // If available_stock is 0 but current_stock > 0, mirror current_stock into available_stock
  // so the UI shows real numbers rather than always "Out of Stock".
  const available = (d.available_stock || 0) > 0
    ? d.available_stock
    : (d.current_stock || 0);
  const physical  = (d.physical_stock  || 0) > 0
    ? d.physical_stock
    : (d.current_stock || 0);

  return {
    ...d,
    available_stock: available,
    physical_stock:  physical,
    product_code:   d.product_id?.code              || '',
    product_name:   d.product_id?.name              || '',
    unit:           d.product_id?.unit              || '',
    gst_percent:    d.product_id?.gst_percent ?? null,
    hsn_code:       d.product_id?.hsn_code           || '',
    brand_name:     d.product_id?.brand_id?.name    || '',
    category_name:  d.product_id?.category_id?.name || '',
    warehouse_name: d.warehouse_id?.name            || '',
    // Who added the product (Admin / Staff App / Retailer App) + the person.
    // Uses the same resolution as Product Management's "ADDED BY" badge.
    added_by_type:  resolveCreatorType(d.product_id),
    added_by_name:  d.product_id?.created_by?.name  || '',
    added_by_role:  d.product_id?.created_by?.role  || '',
  };
}

/** Record a stock movement log entry */
async function logMovement(data) {
  try {
    await StockMovement.create(data);
  } catch (e) {
    console.error('[StockMovement] Failed to log:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/inventory
// ─────────────────────────────────────────────────────────────────────────────
async function listInventory(req, res) {
  const {
    warehouse_id, category_id, brand_id, search,
    stock_status,   // available | low | out | reserved | blocked | all
    page = 1, limit = 50,
  } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  // Super Admin sees ALL inventory across companies — skip the company filter
  // even if their user record happens to carry a company_id.
  const isSuperAdmin = req.user.role === 'Super Admin';
  const query = {};
  if (!isSuperAdmin && req.user.company_id) query.company_id = req.user.company_id;
  if (warehouse_id) query.warehouse_id = warehouse_id;

  // Stock-status filter
  if (stock_status === 'available') query.available_stock = { $gt: 0 };
  if (stock_status === 'low') {
    // Low stock: available > 0 but <= low_stock_alert — must use $and to combine with company_id
    const lowExpr = {
      $and: [
        { $gt:  ['$available_stock', 0] },
        { $gt:  ['$low_stock_alert', 0] },
        { $lte: ['$available_stock', '$low_stock_alert'] },
      ],
    };
    if (query.$expr) {
      query.$and = [{ $expr: query.$expr }, { $expr: lowExpr }];
      delete query.$expr;
    } else {
      query.$expr = lowExpr;
    }
  }
  if (stock_status === 'out')      query.available_stock = 0;
  if (stock_status === 'reserved') query.reserved_stock  = { $gt: 0 };
  if (stock_status === 'blocked')  query.blocked_stock   = { $gt: 0 };

  const [total, docs] = await Promise.all([
    Inventory.countDocuments(query),
    Inventory.find(query)
      .populate({
        path: 'product_id',
        select: 'code name unit gst_percent hsn_code brand_id category_id created_by created_by_type company_id',
        match: (() => {
          const m = {};
          if (search) m.$or = [
            { name: { $regex: search, $options: 'i' } },
            { code: { $regex: search, $options: 'i' } },
          ];
          if (category_id) m.category_id = category_id;
          if (brand_id)    m.brand_id    = brand_id;
          return m;
        })(),
        populate: [
          { path: 'brand_id',    select: 'name' },
          { path: 'category_id', select: 'name' },
          { path: 'created_by',  select: 'name role' },
          { path: 'company_id',  select: 'name biz_type' },
        ],
      })
      .populate('warehouse_id', 'name')
      .sort({ updated_at: -1 })
      .skip(offset)
      .limit(parseInt(limit))
      .lean(),
  ]);

  // Filter out docs where product_id is null (didn't match the populate match)
  const inventory = docs.filter(d => d.product_id).map(flattenInventory);

  sendSuccess(res, { inventory, pagination: paginate(total, parseInt(page), parseInt(limit)) });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/inventory/:id
// ─────────────────────────────────────────────────────────────────────────────
async function getInventoryItem(req, res) {
  const scope = { _id: req.params.id };
  if (req.user.role !== 'Super Admin' && req.user.company_id) scope.company_id = req.user.company_id;

  const doc = await Inventory.findOne(scope)
    .populate({
      path: 'product_id',
      select: 'code name unit brand_id category_id design size finish images',
      populate: [
        { path: 'brand_id',    select: 'name' },
        { path: 'category_id', select: 'name' },
      ],
    })
    .populate('warehouse_id', 'name city state')
    .lean();

  if (!doc) return sendError(res, 'Inventory record not found.', 404);

  // Movements for this product. Match by product_id (always reliable) scoped to
  // the inventory record's company. We deliberately DON'T force warehouse_id —
  // purchase/order/dispatch/adjust movements may carry a different or null
  // warehouse, and requiring an exact match would hide the whole history.
  const movQuery = { product_id: doc.product_id?._id };
  const movCompany = doc.company_id || req.user.company_id;
  if (movCompany) movQuery.company_id = movCompany;
  // If this inventory row is tied to a specific warehouse, prefer movements for
  // that warehouse OR ones with no warehouse recorded.
  const whId = doc.warehouse_id?._id || doc.warehouse_id;
  if (whId) movQuery.$or = [{ warehouse_id: whId }, { warehouse_id: null }];

  const movements = await StockMovement.find(movQuery)
    .sort({ movement_date: -1 })
    .limit(30)
    .lean();

  sendSuccess(res, { ...flattenInventory(doc), movements });
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/inventory/:id/settings — update alert/reorder thresholds
// Body: { low_stock_alert?, reorder_level? }
// ─────────────────────────────────────────────────────────────────────────────
async function updateInventorySettings(req, res) {
  const scope = { _id: req.params.id };
  if (req.user.role !== 'Super Admin' && req.user.company_id) scope.company_id = req.user.company_id;

  const update = {};
  if (req.body.low_stock_alert !== undefined) {
    const v = Number(req.body.low_stock_alert);
    if (Number.isNaN(v) || v < 0) return sendError(res, 'Min stock alert must be zero or more.', 400);
    update.low_stock_alert = v;
  }
  if (req.body.reorder_level !== undefined) {
    const v = Number(req.body.reorder_level);
    if (Number.isNaN(v) || v < 0) return sendError(res, 'Reorder level must be zero or more.', 400);
    update.reorder_level = v;
  }
  if (Object.keys(update).length === 0) {
    return sendError(res, 'Nothing to update.', 400);
  }

  const doc = await Inventory.findOneAndUpdate(scope, { $set: update }, { new: true }).lean();
  if (!doc) return sendError(res, 'Inventory record not found.', 404);
  sendSuccess(res, doc, 'Alert settings updated.');
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/inventory/summary  — dashboard KPIs
// ─────────────────────────────────────────────────────────────────────────────
async function getInventorySummary(req, res) {
  // Super Admin aggregates across all companies even if their user record
  // carries a company_id.
  const cid = req.user.role === 'Super Admin' ? null : req.user.company_id;
  // Super Admin (no company_id) gets aggregate across all companies
  const matchStage = cid
    ? { $match: { company_id: new mongoose.Types.ObjectId(cid.toString()) } }
    : { $match: {} };
  const cidFilter = cid || null;

  const [agg, lowCount, outCount] = await Promise.all([
    Inventory.aggregate([
      matchStage,
      {
        $group: {
          _id:               null,
          total_products:    { $sum: 1 },
          // Use $max of available_stock and current_stock for backward-compat with pre-bucket records
          total_physical:    { $sum: { $max: ['$physical_stock',  '$current_stock'] } },
          total_available:   { $sum: { $max: ['$available_stock', '$current_stock'] } },
          total_reserved:    { $sum: '$reserved_stock' },
          total_picking:     { $sum: '$picking_stock' },
          total_packed:      { $sum: '$packed_stock' },
          total_blocked:     { $sum: '$blocked_stock' },
          total_dispatched:  { $sum: '$dispatched_qty' },
          total_stock_value: { $sum: { $multiply: [{ $max: ['$available_stock', '$current_stock'] }, '$purchase_rate'] } },
        },
      },
    ]),

    // Low stock: available (or current_stock for old records) > 0 but <= low_stock_alert
    Inventory.countDocuments({
      ...(cidFilter ? { company_id: cidFilter } : {}),
      $expr: {
        $and: [
          { $gt: [{ $max: ['$available_stock', '$current_stock'] }, 0] },
          { $gt: ['$low_stock_alert', 0] },
          { $lte: [{ $max: ['$available_stock', '$current_stock'] }, '$low_stock_alert'] },
        ],
      },
    }),

    // Out of stock: both available_stock and current_stock are 0
    Inventory.countDocuments({
      ...(cidFilter ? { company_id: cidFilter } : {}),
      available_stock: 0,
      current_stock:   0,
    }),
  ]);

  const summary = agg[0] || {
    total_products: 0, total_physical: 0, total_available: 0,
    total_reserved: 0, total_picking: 0,  total_packed: 0,
    total_blocked:  0, total_dispatched: 0, total_stock_value: 0,
  };

  sendSuccess(res, {
    ...summary,
    _id:           undefined,
    low_stock:     lowCount,
    out_of_stock:  outCount,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/inventory/adjust — manual stock adjustment (stock-in / correction)
// ─────────────────────────────────────────────────────────────────────────────
async function adjustStock(req, res) {
  const { product_id, warehouse_id, adjustment, reason, reference_type, reference_id, purchase_rate, low_stock_alert } = req.body;
  if (!product_id || adjustment === undefined)
    return sendError(res, 'product_id and adjustment are required.');

  // Resolve the company that owns this stock record. A Super Admin has no
  // company_id of their own, so fall back to the product's company (inventory
  // records — and the Inventory model — require a company_id).
  const Product = require('../../models/Product Management/Product');
  let companyId = req.user.company_id;
  if (!companyId) {
    const prod = await Product.findById(product_id).select('company_id').lean();
    companyId = prod?.company_id || null;
  }
  if (!companyId) {
    return sendError(res, 'Could not resolve the owning company for this product.', 400);
  }

  // The inventory unique index is { product_id, warehouse_id } (company_id is
  // NOT part of it). So match by product + warehouse only — matching on
  // company_id too can miss an existing record and cause a duplicate-key error
  // on insert. company_id is only applied when creating a fresh record.
  const wh = warehouse_id || null;
  const filter = { product_id, warehouse_id: wh };

  let inv = await Inventory.findOne(filter);
  if (!inv) {
    // Auto-create if not exists (first stock-in). Upsert guards against a race
    // where a parallel request created the record between findOne and create.
    inv = await Inventory.findOneAndUpdate(
      filter,
      {
        $setOnInsert: {
          company_id:      companyId,
          product_id,
          warehouse_id:    wh,
          physical_stock:  0,
          available_stock: 0,
          stock_in: 0, stock_out: 0, current_stock: 0,
        },
      },
      { upsert: true, new: true }
    );
  }

  const qty    = parseFloat(adjustment);
  const isIn   = qty > 0;
  const absQty = Math.abs(qty);

  if (!isIn && absQty > inv.available_stock)
    return sendError(res, `Insufficient available stock. Available: ${inv.available_stock}`, 400);

  const prevPhysical   = inv.physical_stock;
  const prevAvailable  = inv.available_stock;

  const physicalUpdate  = isIn ? qty : qty; // both directions mirror
  const availableUpdate = isIn ? qty : qty;

  const update = {
    $inc: {
      physical_stock:  physicalUpdate,
      available_stock: availableUpdate,
      current_stock:   physicalUpdate,   // legacy mirror
      stock_in:        isIn ? absQty : 0,
      stock_out:       isIn ? 0 : absQty,
    },
  };

  if (purchase_rate !== undefined) update.$set = { ...(update.$set || {}), purchase_rate: parseFloat(purchase_rate) };
  // Allow setting the configurable low-stock threshold in the same call.
  if (low_stock_alert !== undefined && low_stock_alert !== '' && !isNaN(parseFloat(low_stock_alert)))
    update.$set = { ...(update.$set || {}), low_stock_alert: parseFloat(low_stock_alert) };

  const updated = await Inventory.findByIdAndUpdate(inv._id, update, { new: true }).lean();

  // ── Low-stock / out-of-stock alerts (fire on downward crossing) ──
  await checkAndNotifyStockLevels(
    req.user.company_id, product_id,
    prevAvailable, updated.available_stock,
    updated.low_stock_alert
  );

  await logMovement({
    company_id:     inv.company_id || companyId,
    product_id,
    warehouse_id:   warehouse_id || null,
    movement_type:  isIn ? 'Stock In' : 'Stock Out',
    quantity:       absQty,
    previous_stock: prevPhysical,
    new_stock:      updated.physical_stock,
    reference_type: reference_type || 'Manual',
    reference_id:   reference_id   || '',
    notes:          reason || (isIn ? 'Manual stock in' : 'Manual stock out'),
    created_by:     req.user._id,
    movement_date:  new Date(),
  });

  sendSuccess(res, updated, 'Stock adjusted.');
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/inventory/reserve
// Called when order is confirmed — moves available → reserved
// Body: { product_id, warehouse_id, qty, order_id, order_code }
// ─────────────────────────────────────────────────────────────────────────────
async function reserveStock(req, res) {
  const { product_id, warehouse_id, qty, order_id, order_code } = req.body;
  if (!product_id || !qty) return sendError(res, 'product_id and qty are required.');

  const absQty = Math.abs(parseFloat(qty));
  const filter = { company_id: req.user.company_id, product_id };
  if (warehouse_id) filter.warehouse_id = warehouse_id;

  const inv = await Inventory.findOne(filter);
  if (!inv)                           return sendError(res, 'No inventory record found.',         404);
  if (inv.available_stock < absQty)   return sendError(res, `Insufficient stock. Available: ${inv.available_stock}`, 400);

  const prev = inv.available_stock;
  const updated = await Inventory.findByIdAndUpdate(inv._id, {
    $inc: { available_stock: -absQty, reserved_stock: absQty },
  }, { new: true }).lean();

  await logMovement({
    company_id:     req.user.company_id,
    product_id,
    warehouse_id:   warehouse_id || null,
    movement_type:  'Stock Out',   // reserved = conceptual stock-out from available
    quantity:       absQty,
    previous_stock: prev,
    new_stock:      updated.available_stock,
    reference_type: 'Order',
    reference_id:   order_id   || '',
    notes:          `Reserved for order ${order_code || order_id || ''}`,
    created_by:     req.user._id,
    movement_date:  new Date(),
  });

  sendSuccess(res, updated, 'Stock reserved for order.');
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/inventory/release-reserve
// Called when an order is cancelled — releases reserved → available
// Body: { product_id, warehouse_id, qty, order_id, order_code }
// ─────────────────────────────────────────────────────────────────────────────
async function releaseReserve(req, res) {
  const { product_id, warehouse_id, qty, order_id, order_code } = req.body;
  if (!product_id || !qty) return sendError(res, 'product_id and qty are required.');

  const absQty = Math.abs(parseFloat(qty));
  const filter = { company_id: req.user.company_id, product_id };
  if (warehouse_id) filter.warehouse_id = warehouse_id;

  const inv = await Inventory.findOne(filter);
  if (!inv) return sendError(res, 'No inventory record found.', 404);

  // Can only release what is actually reserved (or picking/packed — auto-detect)
  const releasable = inv.reserved_stock + inv.picking_stock + inv.packed_stock;
  const actual     = Math.min(absQty, releasable);

  // Distribute release across buckets in reverse order
  let remaining = actual;
  const inc = {};

  if (inv.packed_stock > 0 && remaining > 0) {
    const fromPacked = Math.min(remaining, inv.packed_stock);
    inc.packed_stock   = -fromPacked;
    remaining         -= fromPacked;
  }
  if (inv.picking_stock > 0 && remaining > 0) {
    const fromPicking = Math.min(remaining, inv.picking_stock);
    inc.picking_stock  = -fromPicking;
    remaining         -= fromPicking;
  }
  if (inv.reserved_stock > 0 && remaining > 0) {
    const fromReserved = Math.min(remaining, inv.reserved_stock);
    inc.reserved_stock = -fromReserved;
    remaining         -= fromReserved;
  }
  inc.available_stock = actual;

  const updated = await Inventory.findByIdAndUpdate(inv._id, { $inc: inc }, { new: true }).lean();

  await logMovement({
    company_id:     req.user.company_id,
    product_id,
    warehouse_id:   warehouse_id || null,
    movement_type:  'Reversal',
    quantity:       actual,
    previous_stock: inv.available_stock,
    new_stock:      updated.available_stock,
    reference_type: 'Order',
    reference_id:   order_id || '',
    notes:          `Reserved stock released — order ${order_code || order_id || ''} cancelled`,
    created_by:     req.user._id,
    movement_date:  new Date(),
  });

  sendSuccess(res, updated, 'Reserved stock released back to available.');
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/inventory/start-picking
// reserved → picking
// Body: { product_id, warehouse_id, qty, order_id, order_code }
// ─────────────────────────────────────────────────────────────────────────────
async function startPicking(req, res) {
  const { product_id, warehouse_id, qty, order_id, order_code } = req.body;
  if (!product_id || !qty) return sendError(res, 'product_id and qty are required.');

  const absQty = Math.abs(parseFloat(qty));
  const filter = { company_id: req.user.company_id, product_id };
  if (warehouse_id) filter.warehouse_id = warehouse_id;

  const inv = await Inventory.findOne(filter);
  if (!inv)                         return sendError(res, 'No inventory record found.', 404);
  if (inv.reserved_stock < absQty)  return sendError(res, `Insufficient reserved stock. Reserved: ${inv.reserved_stock}`, 400);

  const updated = await Inventory.findByIdAndUpdate(inv._id, {
    $inc: { reserved_stock: -absQty, picking_stock: absQty },
  }, { new: true }).lean();

  await logMovement({
    company_id:     req.user.company_id,
    product_id,
    warehouse_id:   warehouse_id || null,
    movement_type:  'Transfer Out',
    quantity:       absQty,
    previous_stock: inv.reserved_stock,
    new_stock:      updated.reserved_stock,
    reference_type: 'Order',
    reference_id:   order_id || '',
    notes:          `Picking started — order ${order_code || ''}`,
    created_by:     req.user._id,
    movement_date:  new Date(),
  });

  sendSuccess(res, updated, 'Stock moved to Picking.');
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/inventory/complete-packing
// picking → packed
// Body: { product_id, warehouse_id, qty, order_id, order_code }
// ─────────────────────────────────────────────────────────────────────────────
async function completePacking(req, res) {
  const { product_id, warehouse_id, qty, order_id, order_code } = req.body;
  if (!product_id || !qty) return sendError(res, 'product_id and qty are required.');

  const absQty = Math.abs(parseFloat(qty));
  const filter = { company_id: req.user.company_id, product_id };
  if (warehouse_id) filter.warehouse_id = warehouse_id;

  const inv = await Inventory.findOne(filter);
  if (!inv)                        return sendError(res, 'No inventory record found.', 404);
  if (inv.picking_stock < absQty)  return sendError(res, `Insufficient picking stock. Picking: ${inv.picking_stock}`, 400);

  const updated = await Inventory.findByIdAndUpdate(inv._id, {
    $inc: { picking_stock: -absQty, packed_stock: absQty },
  }, { new: true }).lean();

  await logMovement({
    company_id:     req.user.company_id,
    product_id,
    warehouse_id:   warehouse_id || null,
    movement_type:  'Transfer Out',
    quantity:       absQty,
    previous_stock: inv.picking_stock,
    new_stock:      updated.picking_stock,
    reference_type: 'Order',
    reference_id:   order_id || '',
    notes:          `Packing completed — order ${order_code || ''}`,
    created_by:     req.user._id,
    movement_date:  new Date(),
  });

  sendSuccess(res, updated, 'Stock moved to Packed.');
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/inventory/dispatch-stock-out
// packed → dispatched + physical_stock reduces
// Called by dispatchController.createDispatch (or markDelivered)
// Body: { product_id, warehouse_id, qty, dispatch_id, dispatch_code, order_id }
// ─────────────────────────────────────────────────────────────────────────────
async function dispatchStockOut(req, res) {
  const { product_id, warehouse_id, qty, dispatch_id, dispatch_code, order_id } = req.body;
  if (!product_id || !qty) return sendError(res, 'product_id and qty are required.');

  const absQty = Math.abs(parseFloat(qty));
  const filter = { company_id: req.user.company_id, product_id };
  if (warehouse_id) filter.warehouse_id = warehouse_id;

  const inv = await Inventory.findOne(filter);
  if (!inv) return sendError(res, 'No inventory record found.', 404);

  // Graceful fallback — if packed_stock < qty (e.g. flow was skipped), pull from available
  const fromPacked = Math.min(absQty, inv.packed_stock);
  const fromAvail  = absQty - fromPacked;

  if (fromAvail > 0 && inv.available_stock < fromAvail)
    return sendError(res, `Insufficient stock for dispatch. Packed: ${inv.packed_stock}, Available: ${inv.available_stock}`, 400);

  const inc = {
    packed_stock:    -fromPacked,
    available_stock: -fromAvail,
    physical_stock:  -absQty,       // ← ONLY HERE does physical stock reduce
    current_stock:   -absQty,       // legacy mirror
    dispatched_qty:  +absQty,
    stock_out:       +absQty,       // legacy counter
  };

  const prevPhysical = inv.physical_stock;
  const updated = await Inventory.findByIdAndUpdate(inv._id, { $inc: inc }, { new: true }).lean();

  await logMovement({
    company_id:     req.user.company_id,
    product_id,
    warehouse_id:   warehouse_id || null,
    movement_type:  'Stock Out',
    quantity:       absQty,
    previous_stock: prevPhysical,
    new_stock:      updated.physical_stock,
    reference_type: 'Sale',
    reference_id:   dispatch_id || order_id || '',
    invoice_number: dispatch_code || '',
    notes:          `Dispatched — ${dispatch_code || ''} / Order ${order_id || ''}`,
    created_by:     req.user._id,
    movement_date:  new Date(),
  });

  sendSuccess(res, updated, 'Stock dispatched. Physical stock reduced.');
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/inventory/block
// available → blocked  (damage / QC hold)
// Body: { product_id, warehouse_id, qty, reason }
// ─────────────────────────────────────────────────────────────────────────────
async function blockStock(req, res) {
  const { product_id, warehouse_id, qty, reason } = req.body;
  if (!product_id || !qty) return sendError(res, 'product_id and qty are required.');

  const absQty = Math.abs(parseFloat(qty));
  const filter = { company_id: req.user.company_id, product_id };
  if (warehouse_id) filter.warehouse_id = warehouse_id;

  const inv = await Inventory.findOne(filter);
  if (!inv)                         return sendError(res, 'No inventory record found.', 404);
  if (inv.available_stock < absQty) return sendError(res, `Insufficient available stock. Available: ${inv.available_stock}`, 400);

  const updated = await Inventory.findByIdAndUpdate(inv._id, {
    $inc: { available_stock: -absQty, blocked_stock: absQty },
  }, { new: true }).lean();

  await logMovement({
    company_id:     req.user.company_id,
    product_id,
    warehouse_id:   warehouse_id || null,
    movement_type:  'Adjustment',
    quantity:       absQty,
    previous_stock: inv.available_stock,
    new_stock:      updated.available_stock,
    reference_type: 'Manual',
    reference_id:   '',
    notes:          `Blocked: ${reason || 'No reason provided'}`,
    created_by:     req.user._id,
    movement_date:  new Date(),
  });

  sendSuccess(res, updated, 'Stock blocked.');
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/inventory/movements  — stock movement history
// ─────────────────────────────────────────────────────────────────────────────
async function listMovements(req, res) {
  const { product_id, warehouse_id, movement_type, from_date, to_date, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = {};
  if (req.user.role !== 'Super Admin' && req.user.company_id) query.company_id = req.user.company_id;
  if (product_id)    query.product_id    = product_id;
  if (warehouse_id)  query.warehouse_id  = warehouse_id;
  if (movement_type) query.movement_type = movement_type;
  if (from_date)     query.movement_date = { ...query.movement_date, $gte: new Date(from_date) };
  if (to_date)       query.movement_date = { ...query.movement_date, $lte: new Date(to_date + 'T23:59:59') };

  const [total, movements] = await Promise.all([
    StockMovement.countDocuments(query),
    StockMovement.find(query)
      .populate('product_id',   'code name unit')
      .populate('warehouse_id', 'name')
      .populate('created_by',   'name')
      .sort({ movement_date: -1 })
      .skip(offset)
      .limit(parseInt(limit))
      .lean(),
  ]);

  sendSuccess(res, { movements, pagination: paginate(total, parseInt(page), parseInt(limit)) });
}

module.exports = {
  listInventory,
  getInventoryItem,
  updateInventorySettings,
  getInventorySummary,
  deductStockForOrder,
  restoreStockForOrder,
  adjustStock,
  reserveStock,
  releaseReserve,
  startPicking,
  completePacking,
  dispatchStockOut,
  blockStock,
  listMovements,
  // Pure helpers (no req/res) for Order / Dispatch / Purchase controllers
  reserveStockForOrder,
  releaseReserveForOrder,
  confirmDispatchStockOut,
  checkAndNotifyStockLevels,
};
