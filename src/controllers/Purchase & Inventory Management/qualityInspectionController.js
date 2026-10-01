const { sendSuccess, sendError } = require('../../utils/helpers');
const QualityInspection = require('../../models/Purchase & Inventory Management/QualityInspection');
const GRN               = require('../../models/Purchase & Inventory Management/GRN');

async function nextQCNo(companyId) {
  const last = await QualityInspection.findOne({ company_id: companyId }).sort({ created_at: -1 }).lean();
  const num  = last?.qc_number ? parseInt(last.qc_number.split('-').pop(), 10) || 0 : 0;
  return `QC-${String(num + 1).padStart(4, '0')}`;
}

/** GET /api/quality-inspections */
async function list(req, res) {
  try {
    const { search, status, page = 1, limit = 50 } = req.query;
    const query = { company_id: req.user.company_id };
    if (status) query.status = status;
    if (search) query.$or = [
      { qc_number:   { $regex: search, $options: 'i' } },
      { grn_number:  { $regex: search, $options: 'i' } },
      { supplier_name:{ $regex: search, $options: 'i' } },
    ];
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [total, inspections] = await Promise.all([
      QualityInspection.countDocuments(query),
      QualityInspection.find(query).sort({ created_at: -1 }).skip(skip).limit(parseInt(limit)).lean(),
    ]);
    sendSuccess(res, { inspections, total });
  } catch (e) { sendError(res, e.message); }
}

/** GET /api/quality-inspections/:id */
async function get(req, res) {
  try {
    const doc = await QualityInspection.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
    if (!doc) return sendError(res, 'Not found', 404);
    sendSuccess(res, doc);
  } catch (e) { sendError(res, e.message); }
}

/** POST /api/quality-inspections */
async function create(req, res) {
  try {
    const qc_number = await nextQCNo(req.user.company_id);
    const body = { ...req.body };
    // Pull supplier info from GRN if not provided
    if (body.grn_id && !body.grn_number) {
      const grn = await GRN.findById(body.grn_id).lean();
      if (grn) {
        body.grn_number   = grn.grn_number;
        body.supplier_id  = body.supplier_id  || grn.supplier_id;
        body.supplier_name= body.supplier_name|| grn.supplier_name;
      }
    }
    const doc = await QualityInspection.create({
      ...body,
      company_id: req.user.company_id,
      qc_number,
      created_by: req.user._id,
    });
    sendSuccess(res, doc, 'Quality Inspection created', 201);
  } catch (e) { sendError(res, e.message); }
}

/** PUT /api/quality-inspections/:id */
async function update(req, res) {
  try {
    const doc = await QualityInspection.findOneAndUpdate(
      { _id: req.params.id, company_id: req.user.company_id, status: 'Pending' },
      req.body,
      { new: true }
    );
    if (!doc) return sendError(res, 'Not found or not editable', 404);
    sendSuccess(res, doc, 'Updated');
  } catch (e) { sendError(res, e.message); }
}

/** PATCH /api/quality-inspections/:id/approve */
async function approve(req, res) {
  try {
    const doc = await QualityInspection.findOne({ _id: req.params.id, company_id: req.user.company_id });
    if (!doc) return sendError(res, 'Not found', 404);
    if (doc.status !== 'Pending') return sendError(res, 'Already processed', 400);

    doc.status           = 'Approved';
    doc.approved_by      = req.user._id;
    doc.approved_at      = new Date();
    doc.approval_remarks = req.body.remarks || '';
    await doc.save();
    sendSuccess(res, doc, 'Quality inspection approved');
  } catch (e) { sendError(res, e.message); }
}

/** PATCH /api/quality-inspections/:id/reject */
async function reject(req, res) {
  try {
    const { reason } = req.body;
    if (!reason) return sendError(res, 'Rejection reason required', 400);
    const doc = await QualityInspection.findOneAndUpdate(
      { _id: req.params.id, company_id: req.user.company_id, status: 'Pending' },
      { status: 'Rejected', approval_remarks: reason },
      { new: true }
    );
    if (!doc) return sendError(res, 'Not found or not pending', 404);
    sendSuccess(res, doc, 'Rejected');
  } catch (e) { sendError(res, e.message); }
}

/** DELETE /api/quality-inspections/:id */
async function remove(req, res) {
  try {
    const doc = await QualityInspection.findOneAndDelete({
      _id: req.params.id, company_id: req.user.company_id, status: 'Pending',
    });
    if (!doc) return sendError(res, 'Not found or not deletable', 404);
    sendSuccess(res, null, 'Deleted');
  } catch (e) { sendError(res, e.message); }
}

module.exports = { list, get, create, update, approve, reject, remove };
