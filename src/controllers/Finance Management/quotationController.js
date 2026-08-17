const { sendSuccess, sendError } = require('../../utils/helpers');
const Quotation = require('../../models/Finance Management/Quotation');

/** GET /api/quotations */
async function listQuotations(req, res) {
  const { search, status, page = 1, limit = 200 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = { company_id: req.user.company_id };
  if (status) query.status = status;
  if (search) {
    query.$or = [
      { quotation_no:   { $regex: search, $options: 'i' } },
      { customer_name:  { $regex: search, $options: 'i' } },
      { customer_phone: { $regex: search, $options: 'i' } },
      { enquiry_no:     { $regex: search, $options: 'i' } },
    ];
  }

  const [total, quotations] = await Promise.all([
    Quotation.countDocuments(query),
    Quotation.find(query).sort({ created_at: -1 }).skip(offset).limit(parseInt(limit)).lean(),
  ]);
  sendSuccess(res, { quotations, total, page: parseInt(page), limit: parseInt(limit) });
}

/** GET /api/quotations/:id */
async function getQuotation(req, res) {
  const q = await Quotation.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
  if (!q) return sendError(res, 'Quotation not found.', 404);
  sendSuccess(res, q);
}

/** POST /api/quotations */
async function createQuotation(req, res) {
  const body = req.body;

  // Auto-generate quotation_no if not provided
  let quotation_no = (body.quotation_no || '').trim();
  if (!quotation_no) {
    const last = await Quotation.findOne({ company_id: req.user.company_id, quotation_no: /^QT-/ }).sort({ created_at: -1 }).lean();
    const num  = last?.quotation_no ? parseInt(last.quotation_no.split('-')[1], 10) : 0;
    quotation_no = `QT-${String(num + 1).padStart(4, '0')}`;
  }

  const q = await Quotation.create({
    company_id:      req.user.company_id,
    quotation_no,
    enquiry_id:      body.enquiry_id      || null,
    enquiry_no:      body.enquiry_no      || '',
    delivery_no:     body.delivery_no     || '',
    customer_name:   body.customer_name   || '',
    customer_phone:  body.customer_phone  || '',
    customer_email:  body.customer_email  || '',
    quotation_date:  body.quotation_date  || new Date(),
    valid_until:     body.valid_until     || null,
    items:           Array.isArray(body.items) ? body.items : [],
    freight_charges: parseFloat(body.freight_charges) || 0,
    other_charges:   parseFloat(body.other_charges)   || 0,
    subtotal:        parseFloat(body.subtotal)         || 0,
    gst_amount:      parseFloat(body.gst_amount)       || 0,
    grand_total:     parseFloat(body.grand_total)      || 0,
    remarks:         body.remarks || '',
    terms:           body.terms   || '',
    status:          'draft',
    created_by:      req.user._id,
  });
  sendSuccess(res, q, 'Quotation created.', 201);
}

/** PUT /api/quotations/:id */
async function updateQuotation(req, res) {
  const body = req.body;
  const update = {};
  if (body.enquiry_id      !== undefined) update.enquiry_id      = body.enquiry_id || null;
  if (body.enquiry_no      !== undefined) update.enquiry_no      = body.enquiry_no;
  if (body.delivery_no     !== undefined) update.delivery_no     = body.delivery_no;
  if (body.customer_name   !== undefined) update.customer_name   = body.customer_name;
  if (body.customer_phone  !== undefined) update.customer_phone  = body.customer_phone;
  if (body.customer_email  !== undefined) update.customer_email  = body.customer_email;
  if (body.quotation_date  !== undefined) update.quotation_date  = body.quotation_date;
  if (body.valid_until     !== undefined) update.valid_until     = body.valid_until || null;
  if (body.items           !== undefined) update.items           = Array.isArray(body.items) ? body.items : [];
  if (body.freight_charges !== undefined) update.freight_charges = parseFloat(body.freight_charges) || 0;
  if (body.other_charges   !== undefined) update.other_charges   = parseFloat(body.other_charges)   || 0;
  if (body.subtotal        !== undefined) update.subtotal        = parseFloat(body.subtotal)         || 0;
  if (body.gst_amount      !== undefined) update.gst_amount      = parseFloat(body.gst_amount)       || 0;
  if (body.grand_total     !== undefined) update.grand_total     = parseFloat(body.grand_total)      || 0;
  if (body.remarks         !== undefined) update.remarks         = body.remarks;
  if (body.terms           !== undefined) update.terms           = body.terms;

  const q = await Quotation.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    update,
    { new: true }
  ).lean();
  if (!q) return sendError(res, 'Quotation not found.', 404);
  sendSuccess(res, q, 'Quotation updated.');
}

/** PATCH /api/quotations/:id/status */
async function updateQuotationStatus(req, res) {
  const { status } = req.body;
  const VALID = ['draft', 'sent', 'accepted', 'converted', 'expired', 'cancelled'];
  if (!status || !VALID.includes(status)) return sendError(res, `Invalid status. Valid: ${VALID.join(', ')}`);

  const q = await Quotation.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    { status },
    { new: true }
  ).lean();
  if (!q) return sendError(res, 'Quotation not found.', 404);
  sendSuccess(res, q, `Status updated to ${status}.`);
}

/** DELETE /api/quotations/:id */
async function deleteQuotation(req, res) {
  const result = await Quotation.deleteOne({ _id: req.params.id, company_id: req.user.company_id });
  if (result.deletedCount === 0) return sendError(res, 'Quotation not found.', 404);
  sendSuccess(res, null, 'Quotation deleted.');
}

module.exports = { listQuotations, getQuotation, createQuotation, updateQuotation, updateQuotationStatus, deleteQuotation };
