const { sendSuccess, sendError } = require('../../utils/helpers');
const PurchaseOrder = require('../../models/Purchase & Inventory Management/PurchaseOrder');

async function nextPONo(companyId) {
  const last = await PurchaseOrder.findOne({ company_id: companyId }).sort({ created_at: -1 }).lean();
  const num  = last?.po_number ? parseInt(last.po_number.split('-').pop(), 10) || 0 : 0;
  return `PO-${String(num + 1).padStart(4, '0')}`;
}

function calcTotals(items = [], freight = 0, other = 0) {
  let subtotal = 0, gst_total = 0;
  items.forEach(i => {
    const qty  = Number(i.quantity) || 0;
    const rate = Number(i.rate) || 0;
    const disc = Number(i.discount) || 0;
    const gst  = Number(i.gst_percent) || 0;
    const base = qty * rate * (1 - disc / 100);
    const gstAmt = base * gst / 100;
    i.amount = +(base + gstAmt).toFixed(2);
    subtotal  += base;
    gst_total += gstAmt;
  });
  return {
    subtotal:    +subtotal.toFixed(2),
    gst_total:   +gst_total.toFixed(2),
    grand_total: +(subtotal + gst_total + Number(freight) + Number(other)).toFixed(2),
  };
}

/** GET /api/purchase-orders */
async function list(req, res) {
  try {
    const { search, status, supplier_id, page = 1, limit = 50 } = req.query;
    const query = { company_id: req.user.company_id };
    if (status)      query.status      = { $in: status.split(',') };
    if (supplier_id) query.supplier_id = supplier_id;
    if (search) query.$or = [
      { po_number:    { $regex: search, $options: 'i' } },
      { supplier_name:{ $regex: search, $options: 'i' } },
    ];
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [total, purchase_orders] = await Promise.all([
      PurchaseOrder.countDocuments(query),
      PurchaseOrder.find(query).sort({ created_at: -1 }).skip(skip).limit(parseInt(limit)).lean(),
    ]);
    sendSuccess(res, { purchase_orders, total });
  } catch (e) { sendError(res, e.message); }
}

/** GET /api/purchase-orders/:id */
async function get(req, res) {
  try {
    const doc = await PurchaseOrder.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
    if (!doc) return sendError(res, 'Not found', 404);
    sendSuccess(res, doc);
  } catch (e) { sendError(res, e.message); }
}

/** POST /api/purchase-orders */
async function create(req, res) {
  try {
    const po_number = await nextPONo(req.user.company_id);
    const body = { ...req.body };
    const totals = calcTotals(body.items, body.freight_charges, body.other_charges);
    const doc = await PurchaseOrder.create({
      ...body,
      ...totals,
      company_id:      req.user.company_id,
      po_number,
      created_by:      req.user._id,
      created_by_name: req.user.name || '',
    });
    sendSuccess(res, doc, 'Purchase Order created', 201);
  } catch (e) { sendError(res, e.message); }
}

/** PUT /api/purchase-orders/:id */
async function update(req, res) {
  try {
    const body = { ...req.body };
    const totals = calcTotals(body.items, body.freight_charges, body.other_charges);
    const doc = await PurchaseOrder.findOneAndUpdate(
      { _id: req.params.id, company_id: req.user.company_id, status: { $in: ['Draft','Pending Approval'] } },
      { ...body, ...totals },
      { new: true }
    );
    if (!doc) return sendError(res, 'Not found or not editable', 404);
    sendSuccess(res, doc, 'Updated');
  } catch (e) { sendError(res, e.message); }
}

/** PATCH /api/purchase-orders/:id/status */
async function updateStatus(req, res) {
  try {
    const { status, remarks } = req.body;
    const allowed = ['Pending Approval','Approved','Cancelled','Closed'];
    if (!allowed.includes(status)) return sendError(res, 'Invalid status', 400);

    const doc = await PurchaseOrder.findOne({ _id: req.params.id, company_id: req.user.company_id });
    if (!doc) return sendError(res, 'Not found', 404);

    doc.status = status;
    if (remarks) doc.approval_remarks = remarks;
    if (status === 'Approved') { doc.approved_by = req.user._id; doc.approved_at = new Date(); }
    await doc.save();
    sendSuccess(res, doc, `Status: ${status}`);
  } catch (e) { sendError(res, e.message); }
}

/** PATCH /api/purchase-orders/:id/send */
async function send(req, res) {
  try {
    const doc = await PurchaseOrder.findOneAndUpdate(
      { _id: req.params.id, company_id: req.user.company_id, status: 'Approved' },
      { status: 'Sent' },
      { new: true }
    );
    if (!doc) return sendError(res, 'Not found or not in Approved status', 404);
    sendSuccess(res, doc, 'PO sent to supplier');
  } catch (e) { sendError(res, e.message); }
}

/** DELETE /api/purchase-orders/:id */
async function remove(req, res) {
  try {
    const doc = await PurchaseOrder.findOneAndDelete({
      _id: req.params.id, company_id: req.user.company_id,
      status: { $in: ['Draft', 'Cancelled'] },
    });
    if (!doc) return sendError(res, 'Not found or cannot be deleted', 404);
    sendSuccess(res, null, 'Deleted');
  } catch (e) { sendError(res, e.message); }
}

module.exports = { list, get, create, update, updateStatus, send, remove };
