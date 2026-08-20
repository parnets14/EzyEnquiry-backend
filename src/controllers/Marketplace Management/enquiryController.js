const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const Enquiry      = require('../../models/Marketplace Management/Enquiry');
const Notification = require('../../models/System Management/Notification');
const mongoose     = require('mongoose');

// ── Role sets ────────────────────────────────────────────────
const ENQUIRY_CREATOR_ROLES = ['Retailer', 'Sales Executive', 'Manager', 'Company Owner', 'Super Admin'];
const ENQUIRY_REPLY_ROLES   = ['Wholesaler', 'Manager', 'Company Owner', 'Super Admin'];
const SEE_ALL_ROLES         = ['Wholesaler', 'Manager', 'Accountant', 'Company Owner', 'Super Admin', 'Warehouse Staff', 'Sales Executive'];

/** GET /api/enquiries */
async function listEnquiries(req, res) {
  const { status, search, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = { company_id: req.user.company_id };
  if (status && status !== 'All') query.status = status;
  if (!SEE_ALL_ROLES.includes(req.user?.role)) query.created_by = req.user._id; // Retailer sees own only
  if (search) {
    query.$or = [
      { retailer_name: { $regex: search, $options: 'i' } },
      { product_name:  { $regex: search, $options: 'i' } },
      { enq_code:      { $regex: search, $options: 'i' } },
    ];
  }

  const [total, enquiries] = await Promise.all([
    Enquiry.countDocuments(query),
    Enquiry.find(query)
      .populate('created_by', 'name role')
      .populate('order_id',   'order_code status invoice_number')
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(parseInt(limit))
      .lean(),
  ]);
  sendSuccess(res, { enquiries, pagination: paginate(total, parseInt(page), parseInt(limit)) });
}

/** GET /api/enquiries/stats */
async function enquiryStats(req, res) {
  const rows = await Enquiry.aggregate([
    { $match: { company_id: new mongoose.Types.ObjectId(req.user.company_id.toString()) } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const stats = rows.reduce((acc, r) => ({ ...acc, [r._id]: r.count }), {});
  sendSuccess(res, stats);
}

/** GET /api/enquiries/:id */
async function getEnquiry(req, res) {
  const enq = await Enquiry.findOne({ _id: req.params.id, company_id: req.user.company_id })
    .populate('product_id', 'image_urls')
    .lean();
  if (!enq) return sendError(res, 'Enquiry not found.', 404);
  sendSuccess(res, enq);
}

/** POST /api/enquiries */
async function createEnquiry(req, res) {
  if (!ENQUIRY_CREATOR_ROLES.includes(req.user?.role)) {
    return sendError(res, 'Only Retailers and Sales staff can create enquiries.', 403);
  }

  const { retailer_name, retailer_mobile, qty } = req.body;
  if (!retailer_name || !retailer_mobile || !qty)
    return sendError(res, 'Retailer name, mobile and qty are required.');

  // Auto-generate enq_code
  const last = await Enquiry.findOne({ enq_code: /^ENQ-/ }).sort({ enq_code: -1 }).lean();
  const num  = last?.enq_code ? parseInt(last.enq_code.split('-')[1], 10) : 0;
  const enq_code = `ENQ-${String(num + 1).padStart(4, '0')}`;

  const enq = await Enquiry.create({
    ...req.body,
    enq_code,
    company_id: req.user.company_id,
    created_by: req.user._id,
    status:     'New',
  });

  await Notification.create({
    company_id:   req.user.company_id,
    type:         'enquiry',
    title:        `New Enquiry — ${enq_code}`,
    message:      `New enquiry from ${retailer_name} for ${req.body.product_name || '—'} × ${qty} ${req.body.unit || 'Sq Ft'}`,
    reference_id: enq._id,
  });

  sendSuccess(res, enq, 'Enquiry created.', 201);
}

/** PATCH /api/enquiries/:id */
async function updateEnquiry(req, res) {
  const REPLY_STATUSES = ['Viewed', 'Replied', 'Negotiation', 'Confirmed', 'Cancelled'];

  // Enforce role for wholesaler-action statuses
  if (req.body.status && REPLY_STATUSES.includes(req.body.status)) {
    if (!ENQUIRY_REPLY_ROLES.includes(req.user?.role)) {
      return sendError(res, 'Only Wholesalers and Managers can update enquiry status.', 403);
    }
  }
  if (req.user?.role === 'Retailer' && req.body.status) {
    return sendError(res, 'Retailers cannot change enquiry status.', 403);
  }

  const VALID = ['New', 'Viewed', 'Replied', 'Negotiation', 'Confirmed', 'Cancelled'];
  const update = {};
  if (req.body.status && VALID.includes(req.body.status)) update.status            = req.body.status;
  if (req.body.distributor_reply !== undefined)            update.distributor_reply = req.body.distributor_reply;
  if (req.body.negotiation_note  !== undefined)            update.negotiation_note  = req.body.negotiation_note;
  if (req.body.offered_price     !== undefined)            update.offered_price     = req.body.offered_price;
  if (req.body.remarks           !== undefined)            update.remarks           = req.body.remarks;
  if (req.body.order_id)                                   update.order_id          = req.body.order_id;
  // Allow editing retailer details
  if (req.body.retailer_name    !== undefined)             update.retailer_name     = req.body.retailer_name;
  if (req.body.retailer_mobile  !== undefined)             update.retailer_mobile   = req.body.retailer_mobile;
  if (req.body.retailer_email   !== undefined)             update.retailer_email    = req.body.retailer_email;
  if (req.body.product_id       !== undefined)             update.product_id        = req.body.product_id || null;
  if (req.body.product_code     !== undefined)             update.product_code      = req.body.product_code;
  if (req.body.product_name     !== undefined)             update.product_name      = req.body.product_name;
  if (req.body.qty              !== undefined)             update.qty               = req.body.qty;
  if (req.body.unit             !== undefined)             update.unit              = req.body.unit;
  if (req.body.location         !== undefined)             update.location          = req.body.location;

  const enq = await Enquiry.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    update,
    { new: true }
  ).lean();
  if (!enq) return sendError(res, 'Enquiry not found.', 404);
  sendSuccess(res, enq, 'Enquiry updated.');
}

/** DELETE /api/enquiries/:id */
async function deleteEnquiry(req, res) {
  const enq = await Enquiry.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
  if (!enq) return sendError(res, 'Enquiry not found.', 404);

  // ── Cascade: delete the linked order if it exists ───────────
  if (enq.order_id) {
    const Order = require('../../models/Marketplace Management/Order');
    await Order.deleteOne({ _id: enq.order_id, company_id: req.user.company_id });
  }

  await Enquiry.deleteOne({ _id: req.params.id, company_id: req.user.company_id });

  // Return the deleted order_id so frontend can remove it from state
  sendSuccess(res, { deleted_order_id: enq.order_id || null }, 'Enquiry deleted.');
}

module.exports = { listEnquiries, enquiryStats, getEnquiry, createEnquiry, updateEnquiry, deleteEnquiry };
