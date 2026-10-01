/**
 * inventorySubController.js
 * Handles: UnitConversion, RackBin, Batch/Lot, Shade, Caliber,
 *          DamageRecord, StockAdjustment, StockLedger, Inventory Reports
 */
const { sendSuccess, sendError } = require('../../utils/helpers');
const UnitConversion  = require('../../models/Purchase & Inventory Management/UnitConversion');
const RackBin         = require('../../models/Purchase & Inventory Management/RackBin');
const Batch           = require('../../models/Purchase & Inventory Management/Batch');
const { Shade, Caliber } = require('../../models/Purchase & Inventory Management/Shade');
const DamageRecord    = require('../../models/Purchase & Inventory Management/DamageRecord');
const StockAdjustment = require('../../models/Purchase & Inventory Management/StockAdjustment');
const StockMovement   = require('../../models/Purchase & Inventory Management/StockMovement');
const Inventory       = require('../../models/Purchase & Inventory Management/Inventory');
const Warehouse       = require('../../models/Purchase & Inventory Management/Warehouse');

/* ─────────────────────────────────────────────────────────────
   UNIT CONVERSION
───────────────────────────────────────────────────────────── */
const unitConversionCtrl = {
  list: async (req, res) => {
    try {
      const { product_id } = req.query;
      const query = { company_id: req.user.company_id };
      if (product_id) query.product_id = product_id;
      const units = await UnitConversion.find(query).sort({ created_at: -1 }).lean();
      sendSuccess(res, { units });
    } catch (e) { sendError(res, e.message); }
  },
  get: async (req, res) => {
    try {
      const doc = await UnitConversion.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
      if (!doc) return sendError(res, 'Not found', 404);
      sendSuccess(res, doc);
    } catch (e) { sendError(res, e.message); }
  },
  create: async (req, res) => {
    try {
      const doc = await UnitConversion.create({ ...req.body, company_id: req.user.company_id });
      sendSuccess(res, doc, 'Created', 201);
    } catch (e) { sendError(res, e.message); }
  },
  update: async (req, res) => {
    try {
      const doc = await UnitConversion.findOneAndUpdate(
        { _id: req.params.id, company_id: req.user.company_id }, req.body, { new: true }
      );
      if (!doc) return sendError(res, 'Not found', 404);
      sendSuccess(res, doc, 'Updated');
    } catch (e) { sendError(res, e.message); }
  },
  remove: async (req, res) => {
    try {
      const doc = await UnitConversion.findOneAndDelete({ _id: req.params.id, company_id: req.user.company_id });
      if (!doc) return sendError(res, 'Not found', 404);
      sendSuccess(res, null, 'Deleted');
    } catch (e) { sendError(res, e.message); }
  },
  forProduct: async (req, res) => {
    try {
      const doc = await UnitConversion.findOne({ company_id: req.user.company_id, product_id: req.params.productId }).lean();
      sendSuccess(res, doc || null);
    } catch (e) { sendError(res, e.message); }
  },
};

/* ─────────────────────────────────────────────────────────────
   RACK / BIN
───────────────────────────────────────────────────────────── */
const rackBinCtrl = {
  list: async (req, res) => {
    try {
      const { warehouse_id } = req.query;
      const query = { company_id: req.user.company_id };
      if (warehouse_id) query.warehouse_id = warehouse_id;
      const rack_bins = await RackBin.find(query).sort({ warehouse_name: 1, rack_name: 1 }).lean();
      sendSuccess(res, { rack_bins });
    } catch (e) { sendError(res, e.message); }
  },
  get: async (req, res) => {
    try {
      const doc = await RackBin.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
      if (!doc) return sendError(res, 'Not found', 404);
      sendSuccess(res, doc);
    } catch (e) { sendError(res, e.message); }
  },
  create: async (req, res) => {
    try {
      const body = { ...req.body };
      if (body.warehouse_id && !body.warehouse_name) {
        const wh = await Warehouse.findById(body.warehouse_id).lean();
        if (wh) body.warehouse_name = wh.name;
      }
      const doc = await RackBin.create({ ...body, company_id: req.user.company_id });
      sendSuccess(res, doc, 'Location created', 201);
    } catch (e) { sendError(res, e.message); }
  },
  update: async (req, res) => {
    try {
      const doc = await RackBin.findOneAndUpdate(
        { _id: req.params.id, company_id: req.user.company_id }, req.body, { new: true }
      );
      if (!doc) return sendError(res, 'Not found', 404);
      sendSuccess(res, doc, 'Updated');
    } catch (e) { sendError(res, e.message); }
  },
  remove: async (req, res) => {
    try {
      const doc = await RackBin.findOneAndDelete({ _id: req.params.id, company_id: req.user.company_id });
      if (!doc) return sendError(res, 'Not found', 404);
      sendSuccess(res, null, 'Deleted');
    } catch (e) { sendError(res, e.message); }
  },
  forWarehouse: async (req, res) => {
    try {
      const rack_bins = await RackBin.find({ company_id: req.user.company_id, warehouse_id: req.params.warehouseId }).lean();
      sendSuccess(res, { rack_bins });
    } catch (e) { sendError(res, e.message); }
  },
};

/* ─────────────────────────────────────────────────────────────
   BATCH / LOT
───────────────────────────────────────────────────────────── */
const batchCtrl = {
  list: async (req, res) => {
    try {
      const { product_id, warehouse_id, search } = req.query;
      const query = { company_id: req.user.company_id };
      if (product_id)   query.product_id   = product_id;
      if (warehouse_id) query.warehouse_id  = warehouse_id;
      if (search) query.$or = [
        { batch_no:    { $regex: search, $options: 'i' } },
        { lot_no:      { $regex: search, $options: 'i' } },
        { product_name:{ $regex: search, $options: 'i' } },
      ];
      const batches = await Batch.find(query).sort({ created_at: -1 }).lean();
      sendSuccess(res, { batches });
    } catch (e) { sendError(res, e.message); }
  },
  get: async (req, res) => {
    try {
      const doc = await Batch.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
      if (!doc) return sendError(res, 'Not found', 404);
      sendSuccess(res, doc);
    } catch (e) { sendError(res, e.message); }
  },
  create: async (req, res) => {
    try {
      const doc = await Batch.create({ ...req.body, company_id: req.user.company_id });
      sendSuccess(res, doc, 'Batch created', 201);
    } catch (e) { sendError(res, e.message); }
  },
  update: async (req, res) => {
    try {
      const doc = await Batch.findOneAndUpdate(
        { _id: req.params.id, company_id: req.user.company_id }, req.body, { new: true }
      );
      if (!doc) return sendError(res, 'Not found', 404);
      sendSuccess(res, doc, 'Updated');
    } catch (e) { sendError(res, e.message); }
  },
  remove: async (req, res) => {
    try {
      const doc = await Batch.findOneAndDelete({ _id: req.params.id, company_id: req.user.company_id });
      if (!doc) return sendError(res, 'Not found', 404);
      sendSuccess(res, null, 'Deleted');
    } catch (e) { sendError(res, e.message); }
  },
  stock: async (req, res) => {
    try {
      const batch = await Batch.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
      if (!batch) return sendError(res, 'Not found', 404);
      const inventory = await Inventory.findOne({
        company_id: req.user.company_id,
        product_id: batch.product_id,
        warehouse_id: batch.warehouse_id || null,
      }).lean();
      sendSuccess(res, { batch, inventory, batch_quantity: batch.quantity || 0 });
    } catch (e) { sendError(res, e.message); }
  },
};

/* ─────────────────────────────────────────────────────────────
   SHADE / CALIBER
───────────────────────────────────────────────────────────── */
const shadeCtrl = {
  listShades: async (req, res) => {
    try {
      const { product_id } = req.query;
      const query = { company_id: req.user.company_id };
      if (product_id) query.product_id = product_id;
      const shades = await Shade.find(query).sort({ shade_code: 1 }).lean();
      sendSuccess(res, { shades });
    } catch (e) { sendError(res, e.message); }
  },
  createShade: async (req, res) => {
    try {
      const doc = await Shade.create({ ...req.body, company_id: req.user.company_id });
      sendSuccess(res, doc, 'Shade created', 201);
    } catch (e) { sendError(res, e.message); }
  },
  updateShade: async (req, res) => {
    try {
      const doc = await Shade.findOneAndUpdate(
        { _id: req.params.id, company_id: req.user.company_id }, req.body, { new: true }
      );
      if (!doc) return sendError(res, 'Not found', 404);
      sendSuccess(res, doc, 'Updated');
    } catch (e) { sendError(res, e.message); }
  },
  deleteShade: async (req, res) => {
    try {
      const doc = await Shade.findOneAndDelete({ _id: req.params.id, company_id: req.user.company_id });
      if (!doc) return sendError(res, 'Not found', 404);
      sendSuccess(res, null, 'Deleted');
    } catch (e) { sendError(res, e.message); }
  },
  listCalibers: async (req, res) => {
    try {
      const { product_id } = req.query;
      const query = { company_id: req.user.company_id };
      if (product_id) query.product_id = product_id;
      const calibers = await Caliber.find(query).sort({ caliber_code: 1 }).lean();
      sendSuccess(res, { calibers });
    } catch (e) { sendError(res, e.message); }
  },
  createCaliber: async (req, res) => {
    try {
      const doc = await Caliber.create({ ...req.body, company_id: req.user.company_id });
      sendSuccess(res, doc, 'Caliber created', 201);
    } catch (e) { sendError(res, e.message); }
  },
  updateCaliber: async (req, res) => {
    try {
      const doc = await Caliber.findOneAndUpdate(
        { _id: req.params.id, company_id: req.user.company_id }, req.body, { new: true }
      );
      if (!doc) return sendError(res, 'Not found', 404);
      sendSuccess(res, doc, 'Updated');
    } catch (e) { sendError(res, e.message); }
  },
  deleteCaliber: async (req, res) => {
    try {
      const doc = await Caliber.findOneAndDelete({ _id: req.params.id, company_id: req.user.company_id });
      if (!doc) return sendError(res, 'Not found', 404);
      sendSuccess(res, null, 'Deleted');
    } catch (e) { sendError(res, e.message); }
  },
};

/* ─────────────────────────────────────────────────────────────
   DAMAGE / BREAKAGE
───────────────────────────────────────────────────────────── */
const damageCtrl = {
  list: async (req, res) => {
    try {
      const { status, product_id, warehouse_id, search } = req.query;
      const query = { company_id: req.user.company_id };
      if (status)      query.status      = status;
      if (product_id)  query.product_id  = product_id;
      if (warehouse_id)query.warehouse_id= warehouse_id;
      if (search) query.$or = [
        { damage_no:   { $regex: search, $options: 'i' } },
        { product_name:{ $regex: search, $options: 'i' } },
      ];
      const damages = await DamageRecord.find(query).sort({ created_at: -1 }).lean();
      sendSuccess(res, { damages });
    } catch (e) { sendError(res, e.message); }
  },
  get: async (req, res) => {
    try {
      const doc = await DamageRecord.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
      if (!doc) return sendError(res, 'Not found', 404);
      sendSuccess(res, doc);
    } catch (e) { sendError(res, e.message); }
  },
  create: async (req, res) => {
    try {
      // Auto damage_no
      const last = await DamageRecord.findOne({ company_id: req.user.company_id }).sort({ created_at: -1 }).lean();
      const num  = last?.damage_no ? parseInt(last.damage_no.split('-').pop(), 10) || 0 : 0;
      const damage_no = `DMG-${String(num + 1).padStart(4, '0')}`;
      const doc = await DamageRecord.create({ ...req.body, damage_no, company_id: req.user.company_id, created_by: req.user._id });
      sendSuccess(res, doc, 'Damage record created', 201);
    } catch (e) { sendError(res, e.message); }
  },
  update: async (req, res) => {
    try {
      const doc = await DamageRecord.findOneAndUpdate(
        { _id: req.params.id, company_id: req.user.company_id, status: 'Pending' }, req.body, { new: true }
      );
      if (!doc) return sendError(res, 'Not found or not editable', 404);
      sendSuccess(res, doc, 'Updated');
    } catch (e) { sendError(res, e.message); }
  },
  approve: async (req, res) => {
    try {
      const doc = await DamageRecord.findOne({ _id: req.params.id, company_id: req.user.company_id, status: 'Pending' });
      if (!doc) return sendError(res, 'Not found or not pending', 404);

      // Move qty from available to blocked
      const inv = await Inventory.findOne({
        company_id: req.user.company_id, product_id: doc.product_id, warehouse_id: doc.warehouse_id || null,
      });
      if (inv) {
        const qty = parseFloat(doc.quantity) || 0;
        const prevAvail = Number(inv.available_stock) || 0;
        inv.available_stock = Math.max(0, prevAvail - qty);
        inv.blocked_stock   = (Number(inv.blocked_stock) || 0) + qty;
        inv.current_stock   = inv.available_stock;
        await inv.save();
        await StockMovement.create({
          company_id: req.user.company_id, product_id: doc.product_id,
          product_name: doc.product_name, warehouse_id: doc.warehouse_id || null,
          warehouse_name: doc.warehouse_name, movement_type: 'Stock Out',
          quantity: qty, previous_stock: prevAvail, new_stock: inv.available_stock,
          unit: doc.unit, reference_type: 'Damage', reference_id: doc.damage_no,
          notes: req.body.remarks || doc.damage_reason, created_by: req.user._id, movement_date: new Date(),
        });
      }

      doc.status = 'Approved'; doc.approved_by = req.user._id; doc.approved_at = new Date();
      doc.approval_remarks = req.body.remarks || '';
      await doc.save();
      sendSuccess(res, doc, 'Approved — stock moved to damaged');
    } catch (e) { sendError(res, e.message); }
  },
  remove: async (req, res) => {
    try {
      const doc = await DamageRecord.findOneAndDelete({ _id: req.params.id, company_id: req.user.company_id, status: 'Pending' });
      if (!doc) return sendError(res, 'Not found', 404);
      sendSuccess(res, null, 'Deleted');
    } catch (e) { sendError(res, e.message); }
  },
};

/* ─────────────────────────────────────────────────────────────
   STOCK ADJUSTMENT
───────────────────────────────────────────────────────────── */
const stockAdjCtrl = {
  list: async (req, res) => {
    try {
      const { status, search } = req.query;
      const query = { company_id: req.user.company_id };
      if (status) query.status = status;
      if (search) query.$or = [
        { adjustment_no: { $regex: search, $options: 'i' } },
        { product_name:  { $regex: search, $options: 'i' } },
      ];
      const adjustments = await StockAdjustment.find(query).sort({ created_at: -1 }).lean();
      sendSuccess(res, { adjustments });
    } catch (e) { sendError(res, e.message); }
  },
  get: async (req, res) => {
    try {
      const doc = await StockAdjustment.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
      if (!doc) return sendError(res, 'Not found', 404);
      sendSuccess(res, doc);
    } catch (e) { sendError(res, e.message); }
  },
  create: async (req, res) => {
    try {
      const last = await StockAdjustment.findOne({ company_id: req.user.company_id }).sort({ created_at: -1 }).lean();
      const num  = last?.adjustment_no ? parseInt(last.adjustment_no.split('-').pop(), 10) || 0 : 0;
      const adjustment_no = `ADJ-${String(num + 1).padStart(4, '0')}`;
      const doc = await StockAdjustment.create({ ...req.body, adjustment_no, company_id: req.user.company_id, created_by: req.user._id });
      sendSuccess(res, doc, 'Adjustment created', 201);
    } catch (e) { sendError(res, e.message); }
  },
  approve: async (req, res) => {
    try {
      const doc = await StockAdjustment.findOne({ _id: req.params.id, company_id: req.user.company_id, status: 'Pending' });
      if (!doc) return sendError(res, 'Not found or not pending', 404);

      const qty = parseFloat(doc.quantity) || 0;
      const inv = await Inventory.findOne({
        company_id: req.user.company_id, product_id: doc.product_id, warehouse_id: doc.warehouse_id || null,
      });

      const prevStock = inv ? (Number(inv.available_stock) || 0) : 0;
      const newStock  = doc.adjustment_type === 'Increase'
        ? prevStock + qty
        : Math.max(0, prevStock - qty);

      if (inv) {
        const delta = newStock - prevStock;
        inv.physical_stock  = Math.max(0, (Number(inv.physical_stock)  || 0) + delta);
        inv.available_stock = newStock;
        inv.current_stock   = newStock;
        if (delta > 0) inv.stock_in  = (Number(inv.stock_in)  || 0) + delta;
        else           inv.stock_out = (Number(inv.stock_out) || 0) + Math.abs(delta);
        await inv.save();
      } else if (doc.adjustment_type === 'Increase') {
        await Inventory.create({
          company_id: req.user.company_id, product_id: doc.product_id,
          product_name: doc.product_name, warehouse_id: doc.warehouse_id || null,
          warehouse_name: doc.warehouse_name, physical_stock: qty,
          available_stock: qty, current_stock: qty, stock_in: qty, stock_out: 0,
        });
      }

      await StockMovement.create({
        company_id: req.user.company_id, product_id: doc.product_id,
        product_name: doc.product_name, warehouse_id: doc.warehouse_id || null,
        warehouse_name: doc.warehouse_name,
        movement_type: doc.adjustment_type === 'Increase' ? 'Stock In' : 'Stock Out',
        quantity: qty, previous_stock: prevStock, new_stock: newStock,
        unit: doc.unit, reference_type: 'Adjustment', reference_id: doc.adjustment_no,
        notes: req.body.remarks || doc.reason, created_by: req.user._id, movement_date: new Date(),
      });

      doc.status = 'Approved'; doc.approved_by = req.user._id; doc.approved_at = new Date();
      doc.approval_remarks = req.body.remarks || '';
      await doc.save();
      sendSuccess(res, doc, 'Adjustment approved — inventory updated');
    } catch (e) { sendError(res, e.message); }
  },
  reject: async (req, res) => {
    try {
      const { reason } = req.body;
      if (!reason) return sendError(res, 'Rejection reason required', 400);
      const doc = await StockAdjustment.findOneAndUpdate(
        { _id: req.params.id, company_id: req.user.company_id, status: 'Pending' },
        { status: 'Rejected', approval_remarks: reason }, { new: true }
      );
      if (!doc) return sendError(res, 'Not found or not pending', 404);
      sendSuccess(res, doc, 'Rejected');
    } catch (e) { sendError(res, e.message); }
  },
  remove: async (req, res) => {
    try {
      const doc = await StockAdjustment.findOneAndDelete({ _id: req.params.id, company_id: req.user.company_id, status: 'Pending' });
      if (!doc) return sendError(res, 'Not found', 404);
      sendSuccess(res, null, 'Deleted');
    } catch (e) { sendError(res, e.message); }
  },
};

/* ─────────────────────────────────────────────────────────────
   STOCK LEDGER
───────────────────────────────────────────────────────────── */
const stockLedgerCtrl = {
  list: async (req, res) => {
    try {
      const { product_id, warehouse_id, transaction_type, from_date, to_date, page = 1, limit = 100 } = req.query;
      const query = { company_id: req.user.company_id };
      if (product_id)        query.product_id    = product_id;
      if (warehouse_id)      query.warehouse_id   = warehouse_id;
      if (transaction_type)  query.movement_type  = transaction_type;
      if (from_date || to_date) {
        query.movement_date = {};
        if (from_date) query.movement_date.$gte = new Date(from_date);
        if (to_date)   query.movement_date.$lte = new Date(new Date(to_date).setHours(23, 59, 59, 999));
      }
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const [total, entries] = await Promise.all([
        StockMovement.countDocuments(query),
        StockMovement.find(query).sort({ movement_date: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      ]);
      // Map to ledger shape expected by frontend
      const ledger = entries.map(e => ({
        ...e,
        date:             e.movement_date,
        transaction_type: e.movement_type,
        reference_no:     e.reference_id,
        qty_change:       ['Stock In','Transfer In'].includes(e.movement_type) ? e.quantity : -e.quantity,
        balance_qty:      e.new_stock,
        rate:             e.unit_cost || 0,
        user_name:        e.created_by_name || '',
      }));
      sendSuccess(res, { entries: ledger, total });
    } catch (e) { sendError(res, e.message); }
  },
  productSummary: async (req, res) => {
    try {
      const { productId } = req.params;
      const movements = await StockMovement.find({ company_id: req.user.company_id, product_id: productId })
        .sort({ movement_date: 1 }).lean();
      sendSuccess(res, { movements });
    } catch (e) { sendError(res, e.message); }
  },
  export: async (req, res) => {
    try {
      const { product_id, warehouse_id, transaction_type, from_date, to_date } = req.query;
      const query = { company_id: req.user.company_id };
      if (product_id) query.product_id = product_id;
      if (warehouse_id) query.warehouse_id = warehouse_id;
      if (transaction_type) query.movement_type = transaction_type;
      if (from_date || to_date) {
        query.movement_date = {};
        if (from_date) query.movement_date.$gte = new Date(from_date);
        if (to_date) query.movement_date.$lte = new Date(new Date(to_date).setHours(23, 59, 59, 999));
      }
      const rows = await StockMovement.find(query).sort({ movement_date: -1 }).lean();
      const columns = ['movement_date', 'product_name', 'movement_type', 'quantity', 'unit', 'previous_stock', 'new_stock', 'reference_id', 'notes'];
      const cell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
      const csv = [columns.join(','), ...rows.map(row => columns.map(key => cell(row[key])).join(','))].join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="stock-ledger.csv"');
      res.send(csv);
    } catch (e) { sendError(res, e.message); }
  },
};

/* ─────────────────────────────────────────────────────────────
   INVENTORY REPORTS
───────────────────────────────────────────────────────────── */
const inventoryReportCtrl = {
  currentStock: async (req, res) => {
    try {
      const { warehouse_id, product_id } = req.query;
      const query = { company_id: req.user.company_id };
      if (warehouse_id) query.warehouse_id = warehouse_id;
      if (product_id)   query.product_id   = product_id;
      const data = await Inventory.find(query)
        .populate('product_id', 'name code category_name brand_name unit')
        .populate('warehouse_id', 'name')
        .lean();
      sendSuccess(res, { data });
    } catch (e) { sendError(res, e.message); }
  },
  stockValuation: async (req, res) => {
    try {
      const query = { company_id: req.user.company_id };
      const inv = await Inventory.find(query).lean();
      const data = inv.map(r => ({
        product_name:    r.product_name,
        warehouse_name:  r.warehouse_name,
        available_stock: r.available_stock || 0,
        purchase_rate:   r.purchase_rate   || 0,
        total_value:     (r.available_stock || 0) * (r.purchase_rate || 0),
      }));
      const total_value = data.reduce((a, r) => a + r.total_value, 0);
      sendSuccess(res, { data, total_value });
    } catch (e) { sendError(res, e.message); }
  },
  lowStock: async (req, res) => {
    try {
      const inv = await Inventory.find({ company_id: req.user.company_id }).lean();
      const data = inv.filter(r => {
        const avail = Number(r.available_stock) || 0;
        const alert = Number(r.low_stock_alert) || 0;
        return alert > 0 && avail <= alert;
      });
      sendSuccess(res, { data });
    } catch (e) { sendError(res, e.message); }
  },
  movementReport: async (req, res) => {
    try {
      const { from_date, to_date, warehouse_id, product_id } = req.query;
      const query = { company_id: req.user.company_id };
      if (warehouse_id) query.warehouse_id = warehouse_id;
      if (product_id)   query.product_id   = product_id;
      if (from_date || to_date) {
        query.movement_date = {};
        if (from_date) query.movement_date.$gte = new Date(from_date);
        if (to_date)   query.movement_date.$lte = new Date(new Date(to_date).setHours(23, 59, 59, 999));
      }
      const data = await StockMovement.find(query).sort({ movement_date: -1 }).limit(500).lean();
      sendSuccess(res, { data });
    } catch (e) { sendError(res, e.message); }
  },
  damageReport: async (req, res) => {
    try {
      const { from_date, to_date } = req.query;
      const query = { company_id: req.user.company_id, status: 'Approved' };
      if (from_date || to_date) {
        query.damage_date = {};
        if (from_date) query.damage_date.$gte = new Date(from_date);
        if (to_date)   query.damage_date.$lte = new Date(new Date(to_date).setHours(23, 59, 59, 999));
      }
      const data = await DamageRecord.find(query).sort({ damage_date: -1 }).lean();
      sendSuccess(res, { data });
    } catch (e) { sendError(res, e.message); }
  },
  batchReport: async (req, res) => {
    try {
      const { product_id, warehouse_id } = req.query;
      const query = { company_id: req.user.company_id };
      if (product_id)   query.product_id   = product_id;
      if (warehouse_id) query.warehouse_id  = warehouse_id;
      const data = await Batch.find(query).sort({ date: -1 }).lean();
      sendSuccess(res, { data });
    } catch (e) { sendError(res, e.message); }
  },
  transferReport: async (req, res) => {
    try {
      const StockTransfer = require('../../models/Purchase & Inventory Management/StockTransfer');
      const { from_date, to_date, status } = req.query;
      const query = { company_id: req.user.company_id };
      if (status) query.status = status;
      if (from_date || to_date) {
        query.created_at = {};
        if (from_date) query.created_at.$gte = new Date(from_date);
        if (to_date)   query.created_at.$lte = new Date(new Date(to_date).setHours(23, 59, 59, 999));
      }
      const data = await StockTransfer.find(query).sort({ created_at: -1 }).lean();
      sendSuccess(res, { data });
    } catch (e) { sendError(res, e.message); }
  },
};

/* ─────────────────────────────────────────────────────────────
   PURCHASE REPORTS
───────────────────────────────────────────────────────────── */
const purchaseReportCtrl = {
  purchaseRegister: async (req, res) => {
    try {
      const Purchase = require('../../models/Purchase & Inventory Management/Purchase');
      const { from_date, to_date, supplier_id } = req.query;
      const query = { company_id: req.user.company_id };
      if (supplier_id) query.supplier_id = supplier_id;
      if (from_date || to_date) {
        query.created_at = {};
        if (from_date) query.created_at.$gte = new Date(from_date);
        if (to_date)   query.created_at.$lte = new Date(new Date(to_date).setHours(23, 59, 59));
      }
      const data = await Purchase.find(query).sort({ created_at: -1 }).limit(500).lean();
      sendSuccess(res, { data });
    } catch (e) { sendError(res, e.message); }
  },
  supplierWise: async (req, res) => {
    try {
      const PurchaseOrder = require('../../models/Purchase & Inventory Management/PurchaseOrder');
      const data = await PurchaseOrder.aggregate([
        { $match: { company_id: req.user.company_id } },
        { $group: { _id: '$supplier_name', total_orders: { $sum: 1 }, total_value: { $sum: '$grand_total' } } },
        { $sort: { total_value: -1 } },
      ]);
      sendSuccess(res, { data });
    } catch (e) { sendError(res, e.message); }
  },
  productWise: async (req, res) => {
    try {
      const GRN = require('../../models/Purchase & Inventory Management/GRN');
      const data = await GRN.aggregate([
        { $match: { company_id: req.user.company_id, status: 'Approved' } },
        { $unwind: '$items' },
        { $group: { _id: '$items.product_name', total_received: { $sum: '$items.received_qty' } } },
        { $sort: { total_received: -1 } },
      ]);
      sendSuccess(res, { data });
    } catch (e) { sendError(res, e.message); }
  },
  pendingPOs: async (req, res) => {
    try {
      const PurchaseOrder = require('../../models/Purchase & Inventory Management/PurchaseOrder');
      const data = await PurchaseOrder.find({
        company_id: req.user.company_id,
        status: { $in: ['Approved','Sent','Partially Received'] },
      }).sort({ date: 1 }).lean();
      sendSuccess(res, { data });
    } catch (e) { sendError(res, e.message); }
  },
  grnReport: async (req, res) => {
    try {
      const GRN = require('../../models/Purchase & Inventory Management/GRN');
      const { from_date, to_date, status } = req.query;
      const query = { company_id: req.user.company_id };
      if (status) query.status = status;
      if (from_date || to_date) {
        query.grn_date = {};
        if (from_date) query.grn_date.$gte = new Date(from_date);
        if (to_date)   query.grn_date.$lte = new Date(new Date(to_date).setHours(23, 59, 59));
      }
      const data = await GRN.find(query).sort({ grn_date: -1 }).limit(500).lean();
      sendSuccess(res, { data });
    } catch (e) { sendError(res, e.message); }
  },
  returnReport: async (req, res) => {
    try {
      const PurchaseReturn = require('../../models/Purchase & Inventory Management/PurchaseReturn');
      const data = await PurchaseReturn.find({ company_id: req.user.company_id }).sort({ return_date: -1 }).lean();
      sendSuccess(res, { data });
    } catch (e) { sendError(res, e.message); }
  },
  supplierOutstanding: async (req, res) => {
    try {
      const Payable = require('../../models/Finance Management/Payable');
      const data = await Payable.find({ company_id: req.user.company_id, status: { $ne: 'Paid' } })
        .sort({ due_date: 1 }).lean().catch(() => []);
      sendSuccess(res, { data });
    } catch (e) { sendError(res, e.message); }
  },
};

module.exports = {
  unitConversionCtrl,
  rackBinCtrl,
  batchCtrl,
  shadeCtrl,
  damageCtrl,
  stockAdjCtrl,
  stockLedgerCtrl,
  inventoryReportCtrl,
  purchaseReportCtrl,
};
