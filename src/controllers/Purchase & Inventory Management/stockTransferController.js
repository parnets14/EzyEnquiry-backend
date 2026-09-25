const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const StockTransfer = require('../../models/Purchase & Inventory Management/StockTransfer');
const Inventory     = require('../../models/Purchase & Inventory Management/Inventory');
const StockMovement = require('../../models/Purchase & Inventory Management/StockMovement');
const Product       = require('../../models/Product Management/Product');
const { checkAndNotifyStockLevels } = require('./inventoryController');

async function nextMovementCode() {
  const last = await StockMovement.findOne({ movement_code: /^MOV-/ }).sort({ movement_code: -1 }).lean();
  const num  = last?.movement_code ? parseInt(last.movement_code.split('-')[1], 10) : 0;
  return `MOV-${String(num + 1).padStart(4, '0')}`;
}

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

  const qty = parseFloat(quantity);
  const companyId = req.user.company_id;

  // Fetch product for name/code so movement rows are human-readable
  const product = await Product.findById(product_id).select('code name unit').lean();
  const product_code = product?.code || '';
  const product_name = product?.name || '';
  const unit         = product?.unit || '';

  // Check sufficient stock in source warehouse
  const sourcePrev = await Inventory.findOne({ company_id: companyId, product_id, warehouse_id: from_warehouse })
    .select('current_stock available_stock physical_stock low_stock_alert').lean();
  if (!sourcePrev || parseFloat(sourcePrev.current_stock) < qty)
    return sendError(res, `Insufficient stock. Available: ${sourcePrev?.current_stock || 0}`);

  const srcPrevCurrent   = sourcePrev.current_stock   || 0;
  const srcPrevAvailable = sourcePrev.available_stock || 0;

  // Also pre-fetch destination (so we can pass accurate avail before/after to detector)
  const destPrev = await Inventory.findOne({ company_id: companyId, product_id, warehouse_id: to_warehouse })
    .select('current_stock available_stock physical_stock low_stock_alert').lean();
  const dstPrevCurrent   = destPrev?.current_stock   || 0;
  const dstPrevAvailable = destPrev?.available_stock || 0;

  // Deduct from source warehouse — available first, then physical
  const sourceNew = await Inventory.findOneAndUpdate(
    { company_id: companyId, product_id, warehouse_id: from_warehouse },
    { $inc: { stock_out: qty, current_stock: -qty, physical_stock: -qty, available_stock: -qty } },
    { new: true }
  );

  // Add to destination warehouse — upsert if no record exists yet
  const destNew = await Inventory.findOneAndUpdate(
    { company_id: companyId, product_id, warehouse_id: to_warehouse },
    {
      $setOnInsert: { company_id: companyId },
      $inc: { stock_in: qty, current_stock: qty, physical_stock: qty, available_stock: qty },
    },
    { upsert: true, new: true }
  );

  const transfer = await StockTransfer.create({
    company_id:     companyId,
    from_warehouse, to_warehouse, product_id,
    quantity:       qty,
    notes:          notes  || '',
    reason:         reason || '',
    status:         'Pending',
    transferred_by: req.user._id,
  });

  // ── StockMovement ledger: 1 Transfer Out (source) + 1 Transfer In (dest) ─
  const [moveOutCode, moveInCode] = await Promise.all([nextMovementCode(), nextMovementCode()]);
  await Promise.all([
    StockMovement.create({
      company_id:     companyId,
      movement_code:  moveOutCode,
      product_id,
      product_name,
      product_code,
      warehouse_id:   from_warehouse,
      warehouse_name: '',
      movement_type:  'Transfer',
      movement_direction: 'Out',
      quantity:       qty,
      previous_stock: srcPrevCurrent,
      new_stock:      srcPrevCurrent - qty,
      unit,
      reference_type: 'Transfer',
      reference_id:   String(transfer._id),
      notes:          `Transfer Out — to warehouse ${to_warehouse} (${reason || notes || ''})`.trim(),
      created_by:     req.user._id,
      movement_date:  new Date(),
    }),
    StockMovement.create({
      company_id:     companyId,
      movement_code:  moveInCode,
      product_id,
      product_name,
      product_code,
      warehouse_id:   to_warehouse,
      warehouse_name: '',
      movement_type:  'Transfer',
      movement_direction: 'In',
      quantity:       qty,
      previous_stock: dstPrevCurrent,
      new_stock:      dstPrevCurrent + qty,
      unit,
      reference_type: 'Transfer',
      reference_id:   String(transfer._id),
      notes:          `Transfer In — from warehouse ${from_warehouse} (${reason || notes || ''})`.trim(),
      created_by:     req.user._id,
      movement_date:  new Date(),
    }),
  ]).catch(e => console.error('[StockMovement] transfer create logs failed:', e.message));

  // ── Threshold notifications at both warehouses ──────────────────────
  await Promise.all([
    checkAndNotifyStockLevels(
      companyId, product_id,
      srcPrevAvailable, srcPrevAvailable - qty,
      sourceNew?.low_stock_alert || sourcePrev?.low_stock_alert || null
    ),
    checkAndNotifyStockLevels(
      companyId, product_id,
      dstPrevAvailable, dstPrevAvailable + qty,
      destNew?.low_stock_alert || destPrev?.low_stock_alert || null
    ),
  ]);

  sendSuccess(res, transfer, 'Stock transfer initiated.', 201);
}

/** PATCH /api/stock-transfers/:id/status */
async function updateTransferStatus(req, res) {
  const { status } = req.body;
  const validStatuses = ['Pending', 'In Transit', 'Completed', 'Cancelled'];
  if (!status || !validStatuses.includes(status))
    return sendError(res, `Invalid status. Valid: ${validStatuses.join(', ')}`);

  const companyId = req.user.company_id;
  const transfer = await StockTransfer.findOne({ _id: req.params.id, company_id: companyId }).lean();
  if (!transfer) return sendError(res, 'Transfer not found.', 404);

  // If cancelling, reverse the stock movement + write 2 reversal movement rows
  if (status === 'Cancelled' && !['Cancelled', 'Completed'].includes(transfer.status)) {
    const qty = parseFloat(transfer.quantity);
    const product_id = transfer.product_id;

    const product = await Product.findById(product_id).select('code name unit').lean();
    const product_code = product?.code || '';
    const product_name = product?.name || '';
    const unit         = product?.unit || '';

    // Capture before-reversal stock levels so detector is accurate
    const [srcPrev, dstPrev] = await Promise.all([
      Inventory.findOne({ company_id: companyId, product_id, warehouse_id: transfer.from_warehouse })
        .select('current_stock available_stock physical_stock low_stock_alert').lean(),
      Inventory.findOne({ company_id: companyId, product_id, warehouse_id: transfer.to_warehouse })
        .select('current_stock available_stock physical_stock low_stock_alert').lean(),
    ]);
    const srcPrevAvailable = srcPrev?.available_stock || 0;
    const dstPrevAvailable = dstPrev?.available_stock || 0;
    const srcPrevCurrent   = srcPrev?.current_stock   || 0;
    const dstPrevCurrent   = dstPrev?.current_stock   || 0;

    const [sourceNew, destNew] = await Promise.all([
      Inventory.findOneAndUpdate(
        { company_id: companyId, product_id, warehouse_id: transfer.from_warehouse },
        { $inc: { stock_out: -qty, current_stock: qty, physical_stock: qty, available_stock: qty } },
        { new: true }
      ),
      Inventory.findOneAndUpdate(
        { company_id: companyId, product_id, warehouse_id: transfer.to_warehouse },
        { $inc: { stock_in: -qty, current_stock: -qty, physical_stock: -qty, available_stock: -qty } },
        { new: true }
      ),
    ]);

    // Reversal ledger entries
    const [moveOutRevCode, moveInRevCode] = await Promise.all([nextMovementCode(), nextMovementCode()]);
    await Promise.all([
      StockMovement.create({
        company_id:     companyId,
        movement_code:  moveOutRevCode,
        product_id,
        product_name,
        product_code,
        warehouse_id:   transfer.from_warehouse,
        warehouse_name: '',
        movement_type:  'Transfer',
        movement_direction: 'In',
        quantity:       qty,
        previous_stock: srcPrevCurrent,
        new_stock:      srcPrevCurrent + qty,
        unit,
        reference_type: 'Transfer',
        reference_id:   String(transfer._id),
        notes:          `Cancel Reversal — stock returned to source warehouse (Transfer #${req.params.id})`,
        created_by:     req.user._id,
        movement_date:  new Date(),
      }),
      StockMovement.create({
        company_id:     companyId,
        movement_code:  moveInRevCode,
        product_id,
        product_name,
        product_code,
        warehouse_id:   transfer.to_warehouse,
        warehouse_name: '',
        movement_type:  'Transfer',
        movement_direction: 'Out',
        quantity:       qty,
        previous_stock: dstPrevCurrent,
        new_stock:      dstPrevCurrent - qty,
        unit,
        reference_type: 'Transfer',
        reference_id:   String(transfer._id),
        notes:          `Cancel Reversal — stock removed from destination warehouse (Transfer #${req.params.id})`,
        created_by:     req.user._id,
        movement_date:  new Date(),
      }),
    ]).catch(e => console.error('[StockMovement] transfer cancel logs failed:', e.message));

    // Threshold notifications at both warehouses (post reversal)
    await Promise.all([
      checkAndNotifyStockLevels(
        companyId, product_id,
        srcPrevAvailable, srcPrevAvailable + qty,
        sourceNew?.low_stock_alert || srcPrev?.low_stock_alert || null
      ),
      checkAndNotifyStockLevels(
        companyId, product_id,
        dstPrevAvailable, dstPrevAvailable - qty,
        destNew?.low_stock_alert || dstPrev?.low_stock_alert || null
      ),
    ]);
  }

  const update = { status, approved_by: req.user._id };
  const updated = await StockTransfer.findOneAndUpdate(
    { _id: req.params.id, company_id: companyId },
    update,
    { new: true }
  ).lean();

  sendSuccess(res, updated, `Transfer status updated to ${updated.status}.`);
}

/** DELETE /api/stock-transfers/:id */
async function deleteStockTransfer(req, res) {
  const companyId = req.user.company_id;
  const transfer = await StockTransfer.findOne({ _id: req.params.id, company_id: companyId }).lean();
  if (!transfer) return sendError(res, 'Transfer not found.', 404);
  if (transfer.status === 'Completed') return sendError(res, 'Cannot delete a completed transfer.', 400);

  // Reverse stock if still active + write reversal movement rows
  if (['Pending', 'In Transit'].includes(transfer.status)) {
    const qty = parseFloat(transfer.quantity);
    const product_id = transfer.product_id;

    const product = await Product.findById(product_id).select('code name unit').lean();
    const product_code = product?.code || '';
    const product_name = product?.name || '';
    const unit         = product?.unit || '';

    const [srcPrev, dstPrev] = await Promise.all([
      Inventory.findOne({ company_id: companyId, product_id, warehouse_id: transfer.from_warehouse })
        .select('current_stock available_stock physical_stock low_stock_alert').lean(),
      Inventory.findOne({ company_id: companyId, product_id, warehouse_id: transfer.to_warehouse })
        .select('current_stock available_stock physical_stock low_stock_alert').lean(),
    ]);
    const srcPrevAvailable = srcPrev?.available_stock || 0;
    const dstPrevAvailable = dstPrev?.available_stock || 0;
    const srcPrevCurrent   = srcPrev?.current_stock   || 0;
    const dstPrevCurrent   = dstPrev?.current_stock   || 0;

    const [sourceNew, destNew] = await Promise.all([
      Inventory.findOneAndUpdate(
        { company_id: companyId, product_id, warehouse_id: transfer.from_warehouse },
        { $inc: { stock_out: -qty, current_stock: qty, physical_stock: qty, available_stock: qty } },
        { new: true }
      ),
      Inventory.findOneAndUpdate(
        { company_id: companyId, product_id, warehouse_id: transfer.to_warehouse },
        { $inc: { stock_in: -qty, current_stock: -qty, physical_stock: -qty, available_stock: -qty } },
        { new: true }
      ),
    ]);

    // Reversal ledger entries (mirror of create's two rows)
    const [moveOutRevCode, moveInRevCode] = await Promise.all([nextMovementCode(), nextMovementCode()]);
    await Promise.all([
      StockMovement.create({
        company_id:     companyId,
        movement_code:  moveOutRevCode,
        product_id,
        product_name,
        product_code,
        warehouse_id:   transfer.from_warehouse,
        warehouse_name: '',
        movement_type:  'Transfer',
        movement_direction: 'In',
        quantity:       qty,
        previous_stock: srcPrevCurrent,
        new_stock:      srcPrevCurrent + qty,
        unit,
        reference_type: 'Transfer',
        reference_id:   String(transfer._id),
        notes:          `Delete Reversal — stock returned to source warehouse (Transfer #${req.params.id})`,
        created_by:     req.user._id,
        movement_date:  new Date(),
      }),
      StockMovement.create({
        company_id:     companyId,
        movement_code:  moveInRevCode,
        product_id,
        product_name,
        product_code,
        warehouse_id:   transfer.to_warehouse,
        warehouse_name: '',
        movement_type:  'Transfer',
        movement_direction: 'Out',
        quantity:       qty,
        previous_stock: dstPrevCurrent,
        new_stock:      dstPrevCurrent - qty,
        unit,
        reference_type: 'Transfer',
        reference_id:   String(transfer._id),
        notes:          `Delete Reversal — stock removed from destination warehouse (Transfer #${req.params.id})`,
        created_by:     req.user._id,
        movement_date:  new Date(),
      }),
    ]).catch(e => console.error('[StockMovement] transfer delete logs failed:', e.message));

    await Promise.all([
      checkAndNotifyStockLevels(
        companyId, product_id,
        srcPrevAvailable, srcPrevAvailable + qty,
        sourceNew?.low_stock_alert || srcPrev?.low_stock_alert || null
      ),
      checkAndNotifyStockLevels(
        companyId, product_id,
        dstPrevAvailable, dstPrevAvailable - qty,
        destNew?.low_stock_alert || dstPrev?.low_stock_alert || null
      ),
    ]);
  }

  await StockTransfer.deleteOne({ _id: req.params.id, company_id: companyId });
  sendSuccess(res, null, 'Transfer deleted.');
}

module.exports = { listStockTransfers, getStockTransfer, createStockTransfer, updateTransferStatus, deleteStockTransfer };
