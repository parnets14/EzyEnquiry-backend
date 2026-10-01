const { sendSuccess, sendError } = require('../../utils/helpers');
const PurchaseReturn = require('../../models/Purchase & Inventory Management/PurchaseReturn');
const Inventory      = require('../../models/Purchase & Inventory Management/Inventory');
const StockMovement  = require('../../models/Purchase & Inventory Management/StockMovement');

async function nextReturnNo(companyId) {
  const last = await PurchaseReturn.findOne({ company_id: companyId }).sort({ created_at: -1 }).lean();
  const num  = last?.return_no ? parseInt(last.return_no.split('-').pop(), 10) || 0 : 0;
  return `PRN-${String(num + 1).padStart(4, '0')}`;
}

/** GET /api/purchase-returns */
async function list(req, res) {
  try {
    const { search, status, supplier_id, page = 1, limit = 50 } = req.query;
    const query = { company_id: req.user.company_id };
    if (status)      query.status      = status;
    if (supplier_id) query.supplier_id = supplier_id;
    if (search) query.$or = [
      { return_no:    { $regex: search, $options: 'i' } },
      { po_number:    { $regex: search, $options: 'i' } },
      { supplier_name:{ $regex: search, $options: 'i' } },
    ];
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [total, returns] = await Promise.all([
      PurchaseReturn.countDocuments(query),
      PurchaseReturn.find(query).sort({ created_at: -1 }).skip(skip).limit(parseInt(limit)).lean(),
    ]);
    sendSuccess(res, { returns, total });
  } catch (e) { sendError(res, e.message); }
}

/** GET /api/purchase-returns/:id */
async function get(req, res) {
  try {
    const doc = await PurchaseReturn.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
    if (!doc) return sendError(res, 'Not found', 404);
    sendSuccess(res, doc);
  } catch (e) { sendError(res, e.message); }
}

/** POST /api/purchase-returns */
async function create(req, res) {
  try {
    const return_no = await nextReturnNo(req.user.company_id);
    const body = { ...req.body };
    // Calc total return value
    const total_return_value = (body.items || []).reduce((a, i) => {
      return a + (parseFloat(i.return_qty) || 0) * (parseFloat(i.rate) || 0);
    }, 0);
    body.items = (body.items || []).map(i => ({
      ...i,
      amount: (parseFloat(i.return_qty) || 0) * (parseFloat(i.rate) || 0),
    }));
    const doc = await PurchaseReturn.create({
      ...body,
      total_return_value: +total_return_value.toFixed(2),
      company_id:  req.user.company_id,
      return_no,
      created_by:  req.user._id,
    });
    sendSuccess(res, doc, 'Purchase return created', 201);
  } catch (e) { sendError(res, e.message); }
}

/** PUT /api/purchase-returns/:id */
async function update(req, res) {
  try {
    const doc = await PurchaseReturn.findOneAndUpdate(
      { _id: req.params.id, company_id: req.user.company_id, status: 'Draft' },
      req.body,
      { new: true }
    );
    if (!doc) return sendError(res, 'Not found or not editable', 404);
    sendSuccess(res, doc, 'Updated');
  } catch (e) { sendError(res, e.message); }
}

/** PATCH /api/purchase-returns/:id/status  — Approve reduces stock */
async function updateStatus(req, res) {
  try {
    const { status, remarks } = req.body;
    const allowed = ['Pending', 'Approved', 'Completed', 'Cancelled'];
    if (!allowed.includes(status)) return sendError(res, 'Invalid status', 400);

    const doc = await PurchaseReturn.findOne({ _id: req.params.id, company_id: req.user.company_id });
    if (!doc) return sendError(res, 'Not found', 404);

    const wasApproved = doc.status !== 'Approved' && status === 'Approved';
    doc.status = status;
    if (remarks) doc.approval_remarks = remarks;
    if (status === 'Approved') { doc.approved_by = req.user._id; doc.approved_at = new Date(); }
    await doc.save();

    // If newly approved — reduce inventory stock
    if (wasApproved) {
      for (const item of doc.items) {
        if (!item.product_id || !(parseFloat(item.return_qty) > 0)) continue;
        const returnQty = parseFloat(item.return_qty);
        const inv = await Inventory.findOne({
          company_id:  doc.company_id,
          product_id:  item.product_id,
          warehouse_id: doc.warehouse_id || null,
        });
        if (inv) {
          const prevStock = Number(inv.available_stock) || 0;
          const newStock  = Math.max(0, prevStock - returnQty);
          inv.physical_stock  = Math.max(0, (Number(inv.physical_stock)  || 0) - returnQty);
          inv.available_stock = newStock;
          inv.current_stock   = newStock;
          inv.stock_out       = (Number(inv.stock_out) || 0) + returnQty;
          await inv.save();
          await StockMovement.create({
            company_id:     doc.company_id,
            product_id:     item.product_id,
            product_name:   item.product_name || '',
            warehouse_id:   doc.warehouse_id   || null,
            warehouse_name: doc.warehouse_name || '',
            movement_type:  'Stock Out',
            quantity:       returnQty,
            previous_stock: prevStock,
            new_stock:      newStock,
            unit:           item.unit || '',
            reference_type: 'Purchase Return',
            reference_id:   doc.return_no,
            supplier_id:    doc.supplier_id   || null,
            supplier_name:  doc.supplier_name || '',
            notes:          remarks || '',
            created_by:     req.user._id,
            movement_date:  new Date(),
          });
        }
      }
    }

    sendSuccess(res, doc, `Status: ${status}`);
  } catch (e) { sendError(res, e.message); }
}

/** DELETE /api/purchase-returns/:id */
async function remove(req, res) {
  try {
    const doc = await PurchaseReturn.findOneAndDelete({
      _id: req.params.id, company_id: req.user.company_id, status: { $in: ['Draft','Cancelled'] },
    });
    if (!doc) return sendError(res, 'Not found or not deletable', 404);
    sendSuccess(res, null, 'Deleted');
  } catch (e) { sendError(res, e.message); }
}

module.exports = { list, get, create, update, updateStatus, remove };
