const { sendSuccess, sendError } = require('../../utils/helpers');
const GRN           = require('../../models/Purchase & Inventory Management/GRN');
const PurchaseOrder = require('../../models/Purchase & Inventory Management/PurchaseOrder');
const Inventory     = require('../../models/Purchase & Inventory Management/Inventory');
const StockMovement = require('../../models/Purchase & Inventory Management/StockMovement');

async function nextGRNNo(companyId) {
  const last = await GRN.findOne({ company_id: companyId }).sort({ created_at: -1 }).lean();
  const num  = last?.grn_number ? parseInt(last.grn_number.split('-').pop(), 10) || 0 : 0;
  return `GRN-${String(num + 1).padStart(4, '0')}`;
}

/** GET /api/grns */
async function list(req, res) {
  try {
    const { search, status, supplier_id, po_id, page = 1, limit = 50 } = req.query;
    const query = { company_id: req.user.company_id };
    if (status)      query.status      = status;
    if (supplier_id) query.supplier_id = supplier_id;
    if (po_id)       query.po_id       = po_id;
    if (search) query.$or = [
      { grn_number:        { $regex: search, $options: 'i' } },
      { supplier_name:     { $regex: search, $options: 'i' } },
      { po_number:         { $regex: search, $options: 'i' } },
      { supplier_invoice_no:{ $regex: search, $options: 'i' } },
    ];
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [total, grns] = await Promise.all([
      GRN.countDocuments(query),
      GRN.find(query).sort({ created_at: -1 }).skip(skip).limit(parseInt(limit)).lean(),
    ]);
    sendSuccess(res, { grns, total });
  } catch (e) { sendError(res, e.message); }
}

/** GET /api/grns/:id */
async function get(req, res) {
  try {
    const doc = await GRN.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
    if (!doc) return sendError(res, 'Not found', 404);
    sendSuccess(res, doc);
  } catch (e) { sendError(res, e.message); }
}

/** POST /api/grns */
async function create(req, res) {
  try {
    const grn_number = await nextGRNNo(req.user.company_id);
    // Populate supplier/PO info if po_id provided
    const body = { ...req.body };
    if (body.po_id && !body.po_number) {
      const po = await PurchaseOrder.findById(body.po_id).lean();
      if (po) {
        body.po_number    = po.po_number;
        body.supplier_id  = body.supplier_id  || po.supplier_id;
        body.supplier_name= body.supplier_name|| po.supplier_name;
        body.warehouse_id = body.warehouse_id || po.warehouse_id;
        body.warehouse_name=body.warehouse_name|| po.warehouse_name;
      }
    }
    const doc = await GRN.create({
      ...body,
      company_id:      req.user.company_id,
      grn_number,
      created_by:      req.user._id,
      created_by_name: req.user.name || '',
    });
    sendSuccess(res, doc, 'GRN created', 201);
  } catch (e) { sendError(res, e.message); }
}

/** PUT /api/grns/:id */
async function update(req, res) {
  try {
    const doc = await GRN.findOneAndUpdate(
      { _id: req.params.id, company_id: req.user.company_id, status: 'Draft' },
      req.body,
      { new: true }
    );
    if (!doc) return sendError(res, 'Not found or not editable', 404);
    sendSuccess(res, doc, 'Updated');
  } catch (e) { sendError(res, e.message); }
}

/** PATCH /api/grns/:id/approve  — increases inventory stock */
async function approve(req, res) {
  try {
    const grn = await GRN.findOne({ _id: req.params.id, company_id: req.user.company_id });
    if (!grn)                    return sendError(res, 'Not found', 404);
    if (grn.status === 'Approved') return sendError(res, 'Already approved', 400);
    if (!['Draft','Pending'].includes(grn.status)) return sendError(res, 'Cannot approve this GRN', 400);

    const companyId = req.user.company_id;

    // For each item — increase inventory
    for (const item of grn.items) {
      if (!item.product_id || !(parseFloat(item.received_qty) > 0)) continue;
      const receivedQty = parseFloat(item.received_qty);

      let inv = await Inventory.findOne({
        company_id:  companyId,
        product_id:  item.product_id,
        warehouse_id: grn.warehouse_id || null,
      });

      const prevStock = inv ? (Number(inv.available_stock) || 0) : 0;
      const newStock  = prevStock + receivedQty;

      if (inv) {
        inv.physical_stock   = (Number(inv.physical_stock)  || 0) + receivedQty;
        inv.available_stock  = newStock;
        inv.stock_in         = (Number(inv.stock_in)        || 0) + receivedQty;
        inv.current_stock    = newStock;
        await inv.save();
      } else {
        inv = await Inventory.create({
          company_id:     companyId,
          product_id:     item.product_id,
          product_name:   item.product_name,
          warehouse_id:   grn.warehouse_id || null,
          warehouse_name: grn.warehouse_name || '',
          physical_stock: receivedQty,
          available_stock:receivedQty,
          current_stock:  receivedQty,
          stock_in:       receivedQty,
          stock_out:      0,
          purchase_rate:  item.rate || 0,
        });
      }

      // Stock movement record
      await StockMovement.create({
        company_id:     companyId,
        product_id:     item.product_id,
        product_name:   item.product_name || '',
        warehouse_id:   grn.warehouse_id   || null,
        warehouse_name: grn.warehouse_name || '',
        movement_type:  'Stock In',
        quantity:       receivedQty,
        previous_stock: prevStock,
        new_stock:      newStock,
        unit:           item.unit || '',
        reference_type: 'GRN',
        reference_id:   grn.grn_number,
        supplier_id:    grn.supplier_id   || null,
        supplier_name:  grn.supplier_name || '',
        notes:          req.body.remarks  || '',
        created_by:     req.user._id,
        movement_date:  new Date(),
      });
    }

    // Update PO received quantities
    if (grn.po_id) {
      const po = await PurchaseOrder.findById(grn.po_id);
      if (po) {
        let allReceived = true, anyReceived = false;
        for (const grItem of grn.items) {
          const poItem = po.items.find(p => String(p.product_id) === String(grItem.product_id));
          if (poItem) {
            poItem.received_qty = (Number(poItem.received_qty) || 0) + (parseFloat(grItem.received_qty) || 0);
            if (poItem.received_qty < poItem.quantity) allReceived = false;
            if (poItem.received_qty > 0) anyReceived = true;
          }
        }
        if (allReceived && anyReceived) po.status = 'Fully Received';
        else if (anyReceived)           po.status = 'Partially Received';
        await po.save();
      }
    }

    grn.status       = 'Approved';
    grn.approved_by  = req.user._id;
    grn.approved_at  = new Date();
    grn.approval_remarks = req.body.remarks || '';
    await grn.save();

    sendSuccess(res, grn, 'GRN approved — stock updated');
  } catch (e) { sendError(res, e.message); }
}

/** PATCH /api/grns/:id/cancel */
async function cancel(req, res) {
  try {
    const doc = await GRN.findOneAndUpdate(
      { _id: req.params.id, company_id: req.user.company_id, status: { $in: ['Draft','Pending'] } },
      { status: 'Cancelled' },
      { new: true }
    );
    if (!doc) return sendError(res, 'Not found or cannot be cancelled', 404);
    sendSuccess(res, doc, 'Cancelled');
  } catch (e) { sendError(res, e.message); }
}

/** DELETE /api/grns/:id */
async function remove(req, res) {
  try {
    const doc = await GRN.findOneAndDelete({
      _id: req.params.id, company_id: req.user.company_id, status: 'Draft',
    });
    if (!doc) return sendError(res, 'Not found or not deletable', 404);
    sendSuccess(res, null, 'Deleted');
  } catch (e) { sendError(res, e.message); }
}

module.exports = { list, get, create, update, approve, cancel, remove };
