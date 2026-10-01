const { sendSuccess, sendError } = require('../../utils/helpers');
const PurchaseRequisition = require('../../models/Purchase & Inventory Management/PurchaseRequisition');
const PurchaseOrder       = require('../../models/Purchase & Inventory Management/PurchaseOrder');

async function nextPRNo(companyId) {
  const last = await PurchaseRequisition.findOne({ company_id: companyId }).sort({ created_at: -1 }).lean();
  const num  = last?.requisition_no ? parseInt(last.requisition_no.split('-').pop(), 10) || 0 : 0;
  return `PR-${String(num + 1).padStart(4, '0')}`;
}

/**
 * Normalise an incoming requisition payload so Mongoose never fails to cast.
 * The frontend sends empty strings ('') for unselected ObjectId / Date fields,
 * which Mongoose cannot cast to ObjectId/Date and would reject with a 400.
 * Convert those blanks to null and drop empty line items.
 */
function sanitizeBody(body = {}) {
  const toNull = (v) => (v === '' || v === undefined ? null : v);
  const items = Array.isArray(body.items)
    ? body.items
        // keep only rows that actually reference a product
        .filter((i) => i && (i.product_id || i.product_name))
        .map((i) => ({
          product_id:   toNull(i.product_id),
          product_name: i.product_name || '',
          quantity:     Number(i.quantity) || 0,
          unit:         i.unit || 'Box',
          remarks:      i.remarks || '',
        }))
    : [];

  return {
    ...body,
    supplier_id:   toNull(body.supplier_id),
    warehouse_id:  toNull(body.warehouse_id),
    required_date: toNull(body.required_date),
    date:          toNull(body.date) || new Date(),
    items,
  };
}

/** GET /api/purchase-requisitions */
async function list(req, res) {
  try {
    const { search, status, priority, page = 1, limit = 50 } = req.query;
    const query = { company_id: req.user.company_id };
    if (status)   query.status   = status;
    if (priority) query.priority = priority;
    if (search)   query.$or = [
      { requisition_no: { $regex: search, $options: 'i' } },
      { supplier_name:  { $regex: search, $options: 'i' } },
      { reason:         { $regex: search, $options: 'i' } },
    ];
    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const [total, requisitions] = await Promise.all([
      PurchaseRequisition.countDocuments(query),
      PurchaseRequisition.find(query).sort({ created_at: -1 }).skip(skip).limit(parseInt(limit)).lean(),
    ]);
    sendSuccess(res, { requisitions, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (e) { sendError(res, e.message); }
}

/** GET /api/purchase-requisitions/:id */
async function get(req, res) {
  try {
    const doc = await PurchaseRequisition.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
    if (!doc) return sendError(res, 'Not found', 404);
    sendSuccess(res, doc);
  } catch (e) { sendError(res, e.message); }
}

/** POST /api/purchase-requisitions */
async function create(req, res) {
  try {
    const requisition_no = await nextPRNo(req.user.company_id);
    const doc = await PurchaseRequisition.create({
      ...sanitizeBody(req.body),
      company_id:      req.user.company_id,
      requisition_no,
      created_by:      req.user._id,
      created_by_name: req.user.name || '',
    });
    sendSuccess(res, doc, 'Purchase Requisition created', 201);
  } catch (e) { sendError(res, e.message); }
}

/** PUT /api/purchase-requisitions/:id */
async function update(req, res) {
  try {
    const doc = await PurchaseRequisition.findOneAndUpdate(
      { _id: req.params.id, company_id: req.user.company_id, status: 'Draft' },
      sanitizeBody(req.body),
      { new: true, runValidators: true }
    );
    if (!doc) return sendError(res, 'Not found or not editable', 404);
    sendSuccess(res, doc, 'Updated');
  } catch (e) { sendError(res, e.message); }
}

/** PATCH /api/purchase-requisitions/:id/status */
async function updateStatus(req, res) {
  try {
    const { status, remarks } = req.body;
    const allowed = ['Pending Approval','Approved','Rejected','Cancelled'];
    if (!allowed.includes(status)) return sendError(res, 'Invalid status', 400);

    const doc = await PurchaseRequisition.findOne({ _id: req.params.id, company_id: req.user.company_id });
    if (!doc) return sendError(res, 'Not found', 404);

    doc.status = status;
    if (remarks) doc.approval_remarks = remarks;
    if (status === 'Approved') {
      doc.approved_by = req.user._id;
      doc.approved_at = new Date();
    }
    await doc.save();
    sendSuccess(res, doc, `Status updated to ${status}`);
  } catch (e) { sendError(res, e.message); }
}

/** POST /api/purchase-requisitions/:id/convert-to-po */
async function convertToPO(req, res) {
  try {
    const pr = await PurchaseRequisition.findOne({ _id: req.params.id, company_id: req.user.company_id });
    if (!pr) return sendError(res, 'Not found', 404);
    if (pr.status !== 'Approved') return sendError(res, 'Only Approved requisitions can be converted', 400);

    // Generate PO number
    const last  = await PurchaseOrder.findOne({ company_id: req.user.company_id }).sort({ created_at: -1 }).lean();
    const num   = last?.po_number ? parseInt(last.po_number.split('-').pop(), 10) || 0 : 0;
    const po_number = `PO-${String(num + 1).padStart(4, '0')}`;

    const po = await PurchaseOrder.create({
      company_id:      req.user.company_id,
      po_number,
      date:            new Date(),
      supplier_id:     pr.supplier_id,
      supplier_name:   pr.supplier_name,
      warehouse_id:    pr.warehouse_id,
      warehouse_name:  pr.warehouse_name,
      requisition_id:  pr._id,
      items:           pr.items.map(i => ({
        product_id:   i.product_id,
        product_name: i.product_name,
        quantity:     i.quantity,
        unit:         i.unit,
      })),
      created_by:      req.user._id,
      created_by_name: req.user.name || '',
    });

    pr.status = 'Converted to PO';
    await pr.save();

    sendSuccess(res, { po, pr }, 'Converted to Purchase Order', 201);
  } catch (e) { sendError(res, e.message); }
}

/** DELETE /api/purchase-requisitions/:id */
async function remove(req, res) {
  try {
    const doc = await PurchaseRequisition.findOneAndDelete({
      _id: req.params.id, company_id: req.user.company_id,
      status: { $in: ['Draft', 'Rejected', 'Cancelled'] },
    });
    if (!doc) return sendError(res, 'Not found or cannot be deleted', 404);
    sendSuccess(res, null, 'Deleted');
  } catch (e) { sendError(res, e.message); }
}

module.exports = { list, get, create, update, updateStatus, convertToPO, remove };
