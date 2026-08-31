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
const mongoose      = require('mongoose');

// ── Ensure Warehouse is registered before populate ──────────────────────────
require('../../models/Purchase & Inventory Management/Warehouse');

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Populate and flatten an inventory document */
function flattenInventory(d) {
  return {
    ...d,
    product_code:   d.product_id?.code              || '',
    product_name:   d.product_id?.name              || '',
    unit:           d.product_id?.unit              || '',
    brand_name:     d.product_id?.brand_id?.name    || '',
    category_name:  d.product_id?.category_id?.name || '',
    warehouse_name: d.warehouse_id?.name            || '',
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

  const query = { company_id: req.user.company_id };
  if (warehouse_id) query.warehouse_id = warehouse_id;

  // Stock-status filter
  if (stock_status === 'available') query.available_stock = { $gt: 0 };
  if (stock_status === 'low')       query.$expr = { $and: [
    { $gt: ['$available_stock', 0] },
    { $lte: ['$available_stock', '$low_stock_alert'] },
  ]};
  if (stock_status === 'out')       query.available_stock = 0;
  if (stock_status === 'reserved')  query.reserved_stock  = { $gt: 0 };
  if (stock_status === 'blocked')   query.blocked_stock   = { $gt: 0 };

  const [total, docs] = await Promise.all([
    Inventory.countDocuments(query),
    Inventory.find(query)
      .populate({
        path: 'product_id',
        select: 'code name unit brand_id category_id',
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

  sendSuccess(res, { inventory, pagination: paginate(inventory.length, parseInt(page), parseInt(limit)) });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/inventory/:id
// ─────────────────────────────────────────────────────────────────────────────
async function getInventoryItem(req, res) {
  const doc = await Inventory.findOne({ _id: req.params.id, company_id: req.user.company_id })
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

  const movements = await StockMovement.find({
    product_id:   doc.product_id?._id,
    warehouse_id: doc.warehouse_id?._id || doc.warehouse_id,
    company_id:   req.user.company_id,
  })
    .sort({ movement_date: -1 })
    .limit(20)
    .lean();

  sendSuccess(res, { ...flattenInventory(doc), movements });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/inventory/summary  — dashboard KPIs
// ─────────────────────────────────────────────────────────────────────────────
async function getInventorySummary(req, res) {
  const cid = req.user.company_id;

  const [agg, lowCount, outCount] = await Promise.all([
    Inventory.aggregate([
      { $match: { company_id: new mongoose.Types.ObjectId(cid.toString()) } },
      {
        $group: {
          _id:               null,
          total_products:    { $sum: 1 },
          total_physical:    { $sum: '$physical_stock' },
          total_available:   { $sum: '$available_stock' },
          total_reserved:    { $sum: '$reserved_stock' },
          total_picking:     { $sum: '$picking_stock' },
          total_packed:      { $sum: '$packed_stock' },
          total_blocked:     { $sum: '$blocked_stock' },
          total_dispatched:  { $sum: '$dispatched_qty' },
          total_stock_value: { $sum: { $multiply: ['$available_stock', '$purchase_rate'] } },
        },
      },
    ]),

    // Low stock: available > 0 but <= low_stock_alert
    Inventory.countDocuments({
      company_id: cid,
      $expr: {
        $and: [
          { $gt: ['$available_stock', 0] },
          { $lte: ['$available_stock', '$low_stock_alert'] },
        ],
      },
    }),

    // Out of stock: available = 0
    Inventory.countDocuments({ company_id: cid, available_stock: 0 }),
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
  const { product_id, warehouse_id, adjustment, reason, reference_type, reference_id, purchase_rate } = req.body;
  if (!product_id || adjustment === undefined)
    return sendError(res, 'product_id and adjustment are required.');

  const filter = { company_id: req.user.company_id, product_id };
  if (warehouse_id) filter.warehouse_id = warehouse_id;

  let inv = await Inventory.findOne(filter);
  if (!inv) {
    // Auto-create if not exists (first stock-in)
    inv = await Inventory.create({
      company_id:      req.user.company_id,
      product_id,
      warehouse_id:    warehouse_id || null,
      physical_stock:  0,
      available_stock: 0,
      stock_in: 0, stock_out: 0, current_stock: 0,
    });
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

  if (purchase_rate !== undefined) update.$set = { purchase_rate: parseFloat(purchase_rate) };

  const updated = await Inventory.findByIdAndUpdate(inv._id, update, { new: true }).lean();

  await logMovement({
    company_id:     req.user.company_id,
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

  const query = { company_id: req.user.company_id };
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
  getInventorySummary,
  adjustStock,
  reserveStock,
  releaseReserve,
  startPicking,
  completePacking,
  dispatchStockOut,
  blockStock,
  listMovements,
};
