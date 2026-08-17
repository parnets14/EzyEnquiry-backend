const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const StockTransfer = require('../../models/Purchase & Inventory Management/StockTransfer');
const Inventory     = require('../../models/Purchase & Inventory Management/Inventory');

/** GET /api/stock-transfers */
async function listStockTransfers(req, res) {
  const { status, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = { company_id: req.user.company_id };
  if (status && status !== 'All') query.status = status;

  const [total, docs] = await Promise.all([
    StockTransfer.countDocuments(query),
    StockTransfer.find(query)
      .populate('product_id',     'name code unit')
      .populate('from_warehouse', 'name city')
      .populate('to_warehouse',   'name city')
      .populate('transferred_by', 'name')
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(parseInt(limit))
      .lean(),
  ]);

  const transfers = docs.map(d => ({
    ...d,
    product_name:        d.product_id?.name       || '',
    product_code:        d.product_id?.code       || '',
    product_unit:        d.product_id?.unit       || '',
    from_warehouse_name: d.from_warehouse?.name   || '',
    from_warehouse_city: d.from_warehouse?.city   || '',
    to_warehouse_name:   d.to_warehouse?.name     || '',
    to_warehouse_city:   d.to_warehouse?.city     || '',
    transferred_by_name: d.transferred_by?.name   || '',
  }));

  sendSuccess(res, { transfers, pagination: paginate(total, parseInt(page), parseInt(limit)) });
}

/** GET /api/stock-transfers/:id */
async function getStockTransfer(req, res) {
  const doc = await StockTransfer.findOne({ _id: req.params.id, company_id: req.user.company_id })
    .populate('product_id',     'name code unit')
    .populate('from_warehouse', 'name city')
    .populate('to_warehouse',   'name city')
    .populate('transferred_by', 'name')
    .lean();
  if (!doc) return sendError(res, 'Transfer not found.', 404);

  sendSuccess(res, {
    ...doc,
    product_name:        doc.product_id?.name     || '',
    product_code:        doc.product_id?.code     || '',
    from_warehouse_name: doc.from_warehouse?.name || '',
    to_warehouse_name:   doc.to_warehouse?.name   || '',
    transferred_by_name: doc.transferred_by?.name || '',
  });
}

/** POST /api/stock-transfers */
async function createStockTransfer(req, res) {
  const { from_warehouse, to_warehouse, product_id, quantity, notes, reason } = req.body;
  if (!from_warehouse || !to_warehouse || !product_id || !quantity)
    return sendError(res, 'from_warehouse, to_warehouse, product_id and quantity are required.');
  if (String(from_warehouse) === String(to_warehouse))
    return sendError(res, 'Source and destination warehouses must be different.');
  if (parseFloat(quantity) <= 0)
    return sendError(res, 'Quantity must be greater than 0.');

  // Check sufficient stock in source warehouse
  const source = await Inventory.findOne({ product_id, warehouse_id: from_warehouse }).lean();
  if (!source || parseFloat(source.current_stock) < parseFloat(quantity))
    return sendError(res, `Insufficient stock. Available: ${source?.current_stock || 0}`);

  const qty = parseFloat(quantity);

  // Deduct from source warehouse
  await Inventory.findOneAndUpdate(
    { product_id, warehouse_id: from_warehouse },
    { $inc: { stock_out: qty, current_stock: -qty } }
  );

  // Add to destination warehouse
  await Inventory.findOneAndUpdate(
    { product_id, warehouse_id: to_warehouse },
    {
      $setOnInsert: { company_id: req.user.company_id },
      $inc: { stock_in: qty, current_stock: qty },
    },
    { upsert: true, new: true }
  );

  const transfer = await StockTransfer.create({
    company_id:     req.user.company_id,
    from_warehouse, to_warehouse, product_id,
    quantity:       qty,
    notes:          notes  || '',
    reason:         reason || '',
    status:         'Pending',
    transferred_by: req.user._id,
  });

  sendSuccess(res, transfer, 'Stock transfer initiated.', 201);
}

/** PATCH /api/stock-transfers/:id/status */
async function updateTransferStatus(req, res) {
  const { status } = req.body;
  const validStatuses = ['Pending', 'In Transit', 'Completed', 'Cancelled'];
  if (!status || !validStatuses.includes(status))
    return sendError(res, `Invalid status. Valid: ${validStatuses.join(', ')}`);

  const transfer = await StockTransfer.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
  if (!transfer) return sendError(res, 'Transfer not found.', 404);

  // If cancelling, reverse the stock movement
  if (status === 'Cancelled' && !['Cancelled', 'Completed'].includes(transfer.status)) {
    const qty = parseFloat(transfer.quantity);
    await Inventory.findOneAndUpdate(
      { product_id: transfer.product_id, warehouse_id: transfer.from_warehouse },
      { $inc: { stock_out: -qty, current_stock: qty } }
    );
    await Inventory.findOneAndUpdate(
      { product_id: transfer.product_id, warehouse_id: transfer.to_warehouse },
      { $inc: { stock_in: -qty, current_stock: -qty } }
    );
  }

  const update = { status, approved_by: req.user._id };
  const updated = await StockTransfer.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    update,
    { new: true }
  ).lean();

  sendSuccess(res, updated, `Transfer status updated to ${updated.status}.`);
}

/** DELETE /api/stock-transfers/:id */
async function deleteStockTransfer(req, res) {
  const transfer = await StockTransfer.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
  if (!transfer) return sendError(res, 'Transfer not found.', 404);
  if (transfer.status === 'Completed') return sendError(res, 'Cannot delete a completed transfer.', 400);

  // Reverse stock if still active
  if (['Pending', 'In Transit'].includes(transfer.status)) {
    const qty = parseFloat(transfer.quantity);
    await Inventory.findOneAndUpdate(
      { product_id: transfer.product_id, warehouse_id: transfer.from_warehouse },
      { $inc: { stock_out: -qty, current_stock: qty } }
    );
    await Inventory.findOneAndUpdate(
      { product_id: transfer.product_id, warehouse_id: transfer.to_warehouse },
      { $inc: { stock_in: -qty, current_stock: -qty } }
    );
  }

  await StockTransfer.deleteOne({ _id: req.params.id, company_id: req.user.company_id });
  sendSuccess(res, null, 'Transfer deleted.');
}

module.exports = { listStockTransfers, getStockTransfer, createStockTransfer, updateTransferStatus, deleteStockTransfer };
