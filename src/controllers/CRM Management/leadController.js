const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const Lead     = require('../../models/CRM Management/Lead');
const Customer = require('../../models/CRM Management/Customer');

/** GET /api/leads */
async function listLeads(req, res) {
  const { status, source, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = { company_id: req.user.company_id };
  if (status && status !== 'All') query.status = status;
  if (source && source !== 'All') query.source = source;

  const [total, leads] = await Promise.all([
    Lead.countDocuments(query),
    Lead.find(query)
      .populate('assigned_to', 'name')
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(parseInt(limit))
      .lean(),
  ]);
  sendSuccess(res, { leads, pagination: paginate(total, parseInt(page), parseInt(limit)) });
}

/** POST /api/leads */
async function createLead(req, res) {
  const { name, mobile } = req.body;
  if (!name || !mobile) return sendError(res, 'Name and mobile are required.');

  const lead = await Lead.create({
    company_id:  req.user.company_id,
    name,
    mobile,
    email:       req.body.email       || '',
    source:      req.body.source      || '',
    notes:       req.body.notes       || '',
    assigned_to: req.body.assigned_to || null,
    status:      'New',
  });
  sendSuccess(res, lead, 'Lead created.', 201);
}

/** PUT /api/leads/:id */
async function updateLead(req, res) {
  const { name, mobile, email, source, status, notes, assigned_to } = req.body;
  const VALID = ['New', 'Contacted', 'Qualified', 'Converted', 'Lost'];
  const update = {};
  if (name        !== undefined) update.name        = name;
  if (mobile      !== undefined) update.mobile      = mobile;
  if (email       !== undefined) update.email       = email;
  if (source      !== undefined) update.source      = source;
  if (notes       !== undefined) update.notes       = notes;
  if (assigned_to !== undefined) update.assigned_to = assigned_to || null;
  if (status && VALID.includes(status)) update.status = status;

  const lead = await Lead.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    update,
    { new: true }
  ).lean();
  if (!lead) return sendError(res, 'Lead not found.', 404);
  sendSuccess(res, lead, 'Lead updated.');
}

/** PATCH /api/leads/:id/convert */
async function convertLead(req, res) {
  const lead = await Lead.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
  if (!lead) return sendError(res, 'Lead not found.', 404);
  if (lead.status === 'Converted') return sendError(res, 'Lead already converted.');

  const customer = await Customer.create({
    company_id: req.user.company_id,
    name:       lead.name,
    mobile:     lead.mobile,
    email:      lead.email || '',
    biz_type:   'Retailer',
  });

  const updatedLead = await Lead.findByIdAndUpdate(
    lead._id,
    { status: 'Converted', converted_customer_id: customer._id },
    { new: true }
  ).lean();

  sendSuccess(res, { lead: updatedLead, customer }, 'Lead converted to customer.');
}

/** DELETE /api/leads/:id */
async function deleteLead(req, res) {
  const result = await Lead.deleteOne({ _id: req.params.id, company_id: req.user.company_id });
  if (result.deletedCount === 0) return sendError(res, 'Lead not found.', 404);
  sendSuccess(res, null, 'Lead deleted.');
}

module.exports = { listLeads, createLead, updateLead, convertLead, deleteLead };
