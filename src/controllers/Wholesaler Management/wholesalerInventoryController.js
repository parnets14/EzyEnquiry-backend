/**
 * wholesalerInventoryController.js
 *
 * Wholesaler App — Inventory & Warehouse endpoints.
 * Wholesaler can VIEW inventory. Cannot create products or warehouses.
 * Uses company_id from the authenticated user's token.
 */

const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const Inventory     = require('../../models/Purchase & Inventory Management/Inventory');
const Warehouse     = require('../../models/Purchase & Inventory Management/Warehouse');
const StockMovement = require('../../models/Purchase & Inventory Management/StockMovement');
const mongoose      = require('mongoose');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/wholesaler/warehouses  — list warehouses for this company
// ─────────────────────────────────────────────────────────────────────────────
async function listWarehouses(req, res) {
  const warehouses = await Warehouse.find({
    company_id: req.user.company_id,
    is_active:  true,
  }).sort({ name: 1 }).lean();

  sendSuccess(res, warehouses);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/wholesaler/inventory  — inventory list with stock buckets
// Query: warehouse_id, stock_status, search, category_id, brand_id, page, limit
// ─────────────────────────────────────────────────────────────────────────────
async function listInventory(req, res) {
  const {
    warehouse_id,
    stock_status,   // all | available | low | out | reserved | picking | packed | blocked
    search,
    category_id,
    brand_id,
    page  = 1,
    limit = 50,
  } = req.query;

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const query  = { company_id: req.user.company_id };

  if (warehouse_id && warehouse_id !== 'all') query.warehouse_id = warehouse_id;

  // Stock-status filter
  switch (stock_status) {
    case 'available': query.available_stock = { $gt: 0 };                    break;
    case 'low':
      query.$expr = {
        $and: [
          { $gt:  ['$available_stock', 0] },
          { $lte: ['$available_stock', '$low_stock_alert'] },
        ],
      };
      break;
    case 'out':      query.available_stock = 0;                              break;
    case 'reserved': query.reserved_stock  = { $gt: 0 };                    break;
    case 'picking':  query.picking_stock   = { $gt: 0 };                    break;
    case 'packed':   query.packed_stock    = { $gt: 0 };                    break;
    case 'blocked':  query.blocked_stock   = { $gt: 0 };                    break;
    default: break; // 'all' — no filter
  }

  const productMatch = {};
  if (search)      productMatch.$or = [
    { name: { $regex: search, $options: 'i' } },
    { code: { $regex: search, $options: 'i' } },
  ];
  if (category_id) productMatch.category_id = new mongoose.Types.ObjectId(category_id);
  if (brand_id)    productMatch.brand_id     = new mongoose.Types.ObjectId(brand_id);

  const [total, docs] = await Promise.all([
    Inventory.countDocuments(query),
    Inventory.find(query)
      .populate({
        path:    'product_id',
        select:  'code name unit brand_id category_id design size finish images',
        match:   Object.keys(productMatch).length ? productMatch : undefined,
        populate: [
          { path: 'brand_id',    select: 'name' },
          { path: 'category_id', select: 'name' },
        ],
      })
      .populate('warehouse_id', 'name city state')
      .sort({ updated_at: -1 })
      .skip(offset)
      .limit(parseInt(limit))
      .lean(),
  ]);

  // Drop docs where product_id didn't match the populate filter
  const inventory = docs.filter(d => d.product_id).map(d => ({
    _id:            d._id,
    product_id:     d.product_id._id,
    product_code:   d.product_id.code          || '',
    product_name:   d.product_id.name          || '',
    unit:           d.product_id.unit          || '',
    brand_name:     d.product_id.brand_id?.name    || '',
    category_name:  d.product_id.category_id?.name || '',
    design:         d.product_id.design        || '',
    size:           d.product_id.size          || '',
    finish:         d.product_id.finish        || '',
    images:         d.product_id.images        || [],
    warehouse_id:   d.warehouse_id?._id        || null,
    warehouse_name: d.warehouse_id?.name       || '',
    warehouse_city: d.warehouse_id?.city       || '',
    // ── Stock buckets ──────────────────────────────────────
    physical_stock:  d.physical_stock  || 0,
    available_stock: d.available_stock || 0,
    reserved_stock:  d.reserved_stock  || 0,
    picking_stock:   d.picking_stock   || 0,
    packed_stock:    d.packed_stock    || 0,
    blocked_stock:   d.blocked_stock   || 0,
    dispatched_qty:  d.dispatched_qty  || 0,
    low_stock_alert: d.low_stock_alert || 50,
    purchase_rate:   d.purchase_rate   || 0,
    // ── Derived status ─────────────────────────────────────
    stock_status: (() => {
      const avail = d.available_stock || 0;
      if (avail <= 0)                return 'OUT_OF_STOCK';
      if (avail <= (d.low_stock_alert || 50)) return 'LOW_STOCK';
      return 'AVAILABLE';
    })(),
    updated_at: d.updated_at,
  }));

  sendSuccess(res, { inventory, pagination: paginate(total, parseInt(page), parseInt(limit)) });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/wholesaler/inventory/summary  — dashboard KPIs
// ─────────────────────────────────────────────────────────────────────────────
async function getInventorySummary(req, res) {
  const cid = new mongoose.Types.ObjectId(req.user.company_id.toString());

  const [agg, lowCount, outCount, warehouseCount] = await Promise.all([
    Inventory.aggregate([
      { $match: { company_id: cid } },
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
          total_stock_value: { $sum: { $multiply: ['$available_stock', '$purchase_rate'] } },
        },
      },
    ]),
    Inventory.countDocuments({
      company_id: cid,
      $expr: {
        $and: [
          { $gt:  ['$available_stock', 0] },
          { $lte: ['$available_stock', '$low_stock_alert'] },
        ],
      },
    }),
    Inventory.countDocuments({ company_id: cid, available_stock: 0 }),
    Warehouse.countDocuments({ company_id: cid, is_active: true }),
  ]);

  const s = agg[0] || {};
  sendSuccess(res, {
    total_products:    s.total_products    || 0,
    total_physical:    s.total_physical    || 0,
    total_available:   s.total_available   || 0,
    total_reserved:    s.total_reserved    || 0,
    total_picking:     s.total_picking     || 0,
    total_packed:      s.total_packed      || 0,
    total_blocked:     s.total_blocked     || 0,
    total_stock_value: s.total_stock_value || 0,
    low_stock:         lowCount,
    out_of_stock:      outCount,
    warehouse_count:   warehouseCount,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/wholesaler/inventory/:id  — single inventory item detail + movements
// ─────────────────────────────────────────────────────────────────────────────
async function getInventoryItem(req, res) {
  const doc = await Inventory.findOne({
    _id:        req.params.id,
    company_id: req.user.company_id,
  })
    .populate({
      path:    'product_id',
      select:  'code name unit brand_id category_id design size finish images description gst_rate',
      populate: [
        { path: 'brand_id',    select: 'name' },
        { path: 'category_id', select: 'name' },
      ],
    })
    .populate('warehouse_id', 'name address city state pincode contact_person mobile')
    .lean();

  if (!doc) return sendError(res, 'Inventory record not found.', 404);

  const movements = await StockMovement.find({
    company_id:   req.user.company_id,
    product_id:   doc.product_id?._id,
    warehouse_id: doc.warehouse_id?._id || doc.warehouse_id,
  })
    .populate('created_by', 'name')
    .sort({ movement_date: -1 })
    .limit(30)
    .lean();

  sendSuccess(res, {
    _id:            doc._id,
    product_id:     doc.product_id?._id,
    product_code:   doc.product_id?.code              || '',
    product_name:   doc.product_id?.name              || '',
    unit:           doc.product_id?.unit              || '',
    brand_name:     doc.product_id?.brand_id?.name    || '',
    category_name:  doc.product_id?.category_id?.name || '',
    design:         doc.product_id?.design            || '',
    size:           doc.product_id?.size              || '',
    finish:         doc.product_id?.finish            || '',
    images:         doc.product_id?.images            || [],
    description:    doc.product_id?.description       || '',
    gst_rate:       doc.product_id?.gst_rate          || 18,
    warehouse_id:   doc.warehouse_id?._id             || null,
    warehouse_name: doc.warehouse_id?.name            || '',
    warehouse_city: doc.warehouse_id?.city            || '',
    warehouse_address: doc.warehouse_id?.address      || '',
    physical_stock:  doc.physical_stock  || 0,
    available_stock: doc.available_stock || 0,
    reserved_stock:  doc.reserved_stock  || 0,
    picking_stock:   doc.picking_stock   || 0,
    packed_stock:    doc.packed_stock    || 0,
    blocked_stock:   doc.blocked_stock   || 0,
    dispatched_qty:  doc.dispatched_qty  || 0,
    low_stock_alert: doc.low_stock_alert || 50,
    purchase_rate:   doc.purchase_rate   || 0,
    updated_at:      doc.updated_at,
    movements,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/wholesaler/inventory/movements  — stock movement history
// ─────────────────────────────────────────────────────────────────────────────
async function listMovements(req, res) {
  const {
    product_id, warehouse_id, movement_type,
    from_date, to_date, page = 1, limit = 50,
  } = req.query;
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
  listWarehouses,
  listInventory,
  getInventorySummary,
  getInventoryItem,
  listMovements,
};
