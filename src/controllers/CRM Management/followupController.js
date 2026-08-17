const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const Followup = require('../../models/CRM Management/Followup');

/** GET /api/followups */
async function listFollowups(req, res) {
  const { status, lead_id, customer_id, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = { company_id: req.user.company_id };
  if (status)      query.status      = status;
  if (lead_id)     query.lead_id     = lead_id;
  if (customer_id) query.customer_id = customer_id;

  const [total, followups] = await Promise.all([
    Followup.countDocuments(query),
    Followup.find(query)
      .populate('lead_id',     'name')
      .populate('customer_id', 'name')
      .populate('assigned_to', 'name')
      .sort({ followup_date: 1 })
      .skip(offset)
      .limit(parseInt(limit))
      .lean(),
  ]);
  sendSuccess(res, { followups, pagination: paginate(total, parseInt(page), parseInt(limit)) });
}

/** POST /api/followups */
async function createFollowup(req, res) {
  const { followup_date } = req.body;
  if (!followup_date) return sendError(res, 'followup_date is required.');

  const followup = await Followup.create({
    company_id:    req.user.company_id,
    lead_id:       req.body.lead_id     || null,
    customer_id:   req.body.customer_id || null,
    followup_date,
    notes:         req.body.notes       || '',
    assigned_to:   req.body.assigned_to || null,
    status:        'Pending',
  });
  sendSuccess(res, followup, 'Follow-up scheduled.', 201);
}

/** PUT /api/followups/:id */
async function updateFollowup(req, res) {
  const { followup_date, notes, status, done_at } = req.body;
  const VALID = ['Pending', 'Done', 'Missed'];
  const update = {};
  if (followup_date !== undefined) update.followup_date = followup_date;
  if (notes         !== undefined) update.notes         = notes;
  if (done_at       !== undefined) update.done_at       = done_at || null;
  if (status && VALID.includes(status)) update.status   = status;

  const followup = await Followup.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    update,
    { new: true }
  ).lean();
  if (!followup) return sendError(res, 'Follow-up not found.', 404);
  sendSuccess(res, followup, 'Follow-up updated.');
}

/** DELETE /api/followups/:id */
async function deleteFollowup(req, res) {
  const result = await Followup.deleteOne({ _id: req.params.id, company_id: req.user.company_id });
  if (result.deletedCount === 0) return sendError(res, 'Follow-up not found.', 404);
  sendSuccess(res, null, 'Follow-up deleted.');
}

module.exports = { listFollowups, createFollowup, updateFollowup, deleteFollowup };
