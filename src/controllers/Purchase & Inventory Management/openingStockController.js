const { sendSuccess, sendError } = require('../../utils/helpers');
const OpeningStock  = require('../../models/Purchase & Inventory Management/OpeningStock');
const Inventory     = require('../../models/Purchase & Inventory Management/Inventory');
const StockMovement = require('../../models/Purchase & Inventory Management/StockMovement');

async function nextEntryNo(companyId) {
  const last = await OpeningStock.findOne({ company_id: companyId }).sort({ created_at: -1 }).lean();
  const num  = last?.entry_no ? parseInt(last.entry_no.split('-').pop(), 10) || 0 : 0;
  return `OS-${String(num + 1).padStart(4, '0')}`;
}

/** GET /api/inventory/opening-stock */
async function list(req, res) {
  try {
    const { page = 1, limit = 50 } = req.query;
    const query = { company_id: req.user.company_id };
    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const [total, opening_stocks] = await Promise.all([
      OpeningStock.countDocuments(query),
      OpeningStock.find(query).sort({ created_at: -1 }).skip(skip).limit(parseInt(limit)).lean(),
    ]);
    sendSuccess(res, { opening_stocks, total });
  } catch (e) { sendError(res, e.message); }
}

/** GET /api/inventory/opening-stock/:id */
async function get(req, res) {
  try {
    const doc = await OpeningStock.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
    if (!doc) return sendError(res, 'Not found', 404);
    sendSuccess(res, doc);
  } catch (e) { sendError(res, e.message); }
}

/** POST /api/inventory/opening-stock — creates inventory transactions */
async function create(req, res) {
  try {
    const entry_no = await nextEntryNo(req.user.company_id);
    const body = { ...req.body };
    const doc  = await OpeningStock.create({
      ...body,
      company_id: req.user.company_id,
      entry_no,
      created_by: req.user._id,
    });

    // Update inventory for each item
    for (const item of doc.items) {
      if (!item.product_id || !(parseFloat(item.quantity) > 0)) continue;
      const qty = parseFloat(item.quantity);

      let inv = await Inventory.findOne({
        company_id:   req.user.company_id,
        product_id:   item.product_id,
        warehouse_id: doc.warehouse_id || null,
      });

      const prevStock = inv ? (Number(inv.available_stock) || 0) : 0;
      const newStock  = prevStock + qty;

      if (inv) {
        inv.physical_stock  = (Number(inv.physical_stock)  || 0) + qty;
        inv.available_stock = newStock;
        inv.current_stock   = newStock;
        inv.stock_in        = (Number(inv.stock_in) || 0) + qty;
        if (item.cost) inv.purchase_rate = item.cost;
        await inv.save();
      } else {
        await Inventory.create({
          company_id:     req.user.company_id,
          product_id:     item.product_id,
          product_name:   item.product_name || '',
          warehouse_id:   doc.warehouse_id   || null,
          warehouse_name: doc.warehouse_name || '',
          physical_stock: qty,
          available_stock:qty,
          current_stock:  qty,
          stock_in:       qty,
          stock_out:      0,
          purchase_rate:  item.cost || 0,
        });
      }

      await StockMovement.create({
        company_id:     req.user.company_id,
        product_id:     item.product_id,
        product_name:   item.product_name || '',
        warehouse_id:   doc.warehouse_id   || null,
        warehouse_name: doc.warehouse_name || '',
        movement_type:  'Stock In',
        quantity:       qty,
        previous_stock: prevStock,
        new_stock:      newStock,
        unit:           item.unit || '',
        reference_type: 'Opening Stock',
        reference_id:   doc.entry_no,
        notes:          body.remarks || 'Opening stock entry',
        created_by:     req.user._id,
        movement_date:  doc.date || new Date(),
      });
    }

    sendSuccess(res, doc, 'Opening stock created and inventory updated', 201);
  } catch (e) { sendError(res, e.message); }
}

/** PUT /api/inventory/opening-stock/:id */
async function update(req, res) {
  try {
    const doc = await OpeningStock.findOneAndUpdate(
      { _id: req.params.id, company_id: req.user.company_id },
      req.body,
      { new: true }
    );
    if (!doc) return sendError(res, 'Not found', 404);
    sendSuccess(res, doc, 'Updated');
  } catch (e) { sendError(res, e.message); }
}

/** DELETE /api/inventory/opening-stock/:id */
async function remove(req, res) {
  try {
    const doc = await OpeningStock.findOneAndDelete({ _id: req.params.id, company_id: req.user.company_id });
    if (!doc) return sendError(res, 'Not found', 404);
    sendSuccess(res, null, 'Deleted');
  } catch (e) { sendError(res, e.message); }
}

module.exports = { list, get, create, update, remove };
