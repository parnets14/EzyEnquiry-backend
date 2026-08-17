const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const Inventory = require('../../models/Purchase & Inventory Management/Inventory');
// Ensure Warehouse schema is registered before populate runs
require('../../models/Purchase & Inventory Management/Warehouse');

/** GET /api/inventory */
async function listInventory(req, res) {
  const { warehouse_id, low_stock, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = { company_id: req.user.company_id };
  if (warehouse_id)        query.warehouse_id = warehouse_id;
  if (low_stock === 'true') query.$expr = { $lte: ['$current_stock', '$low_stock_alert'] };

  const [total, docs] = await Promise.all([
    Inventory.countDocuments(query),
    Inventory.find(query)
      .populate({
        path: 'product_id',
        select: 'code name unit brand_id category_id',
        populate: [
          { path: 'brand_id',    select: 'name' },
          { path: 'category_id', select: 'name' },
        ],
      })
      .populate('warehouse_id', 'name')
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(parseInt(limit))
      .lean(),
  ]);

  const inventory = docs.map(d => ({
    ...d,
    product_code:   d.product_id?.code              || '',
    product_name:   d.product_id?.name              || '',
    unit:           d.product_id?.unit              || '',
    brand_name:     d.product_id?.brand_id?.name    || '',
    category_name:  d.product_id?.category_id?.name || '',
    warehouse_name: d.warehouse_id?.name            || '',
  }));

  sendSuccess(res, { inventory, pagination: paginate(total, parseInt(page), parseInt(limit)) });
}

/** PATCH /api/inventory/adjust */
async function adjustStock(req, res) {
  const { product_id, warehouse_id, adjustment } = req.body;
  if (!product_id || adjustment === undefined)
    return sendError(res, 'product_id and adjustment are required.');

  const inv = await Inventory.findOne({ product_id, warehouse_id }).lean();
  if (!inv) return sendError(res, 'Inventory record not found. Please make a purchase for this product first.', 404);

  const newStock = parseFloat(inv.current_stock) + parseFloat(adjustment);
  if (newStock < 0) return sendError(res, 'Insufficient stock.', 400);

  const inc = {};
  if (parseFloat(adjustment) > 0) inc.stock_in  = parseFloat(adjustment);
  if (parseFloat(adjustment) < 0) inc.stock_out = Math.abs(parseFloat(adjustment));

  const updated = await Inventory.findOneAndUpdate(
    { product_id, warehouse_id },
    { $set: { current_stock: newStock }, $inc: inc },
    { new: true }
  ).lean();

  sendSuccess(res, updated, 'Stock adjusted.');
}

module.exports = { listInventory, adjustStock };
