const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const Customer   = require('../../models/CRM Management/Customer');
const Order      = require('../../models/Marketplace Management/Order');
const Enquiry    = require('../../models/Marketplace Management/Enquiry');
const Receivable = require('../../models/Finance Management/Receivable');
const mongoose   = require('mongoose');

/** GET /api/customers */
async function listCustomers(req, res) {
  const { search, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = { company_id: req.user.company_id };
  if (search) {
    query.$or = [
      { name:   { $regex: search, $options: 'i' } },
      { mobile: { $regex: search, $options: 'i' } },
    ];
  }

  const [total, customers] = await Promise.all([
    Customer.countDocuments(query),
    Customer.find(query).sort({ name: 1 }).skip(offset).limit(parseInt(limit)).lean(),
  ]);
  sendSuccess(res, { customers, pagination: paginate(total, parseInt(page), parseInt(limit)) });
}

/** GET /api/customers/:id */
async function getCustomer(req, res) {
  const customer = await Customer.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
  if (!customer) return sendError(res, 'Customer not found.', 404);

  const cust_id = new mongoose.Types.ObjectId(req.params.id);
  const cid     = new mongoose.Types.ObjectId(req.user.company_id.toString());

  const [orders, enquiries, receivables] = await Promise.all([
    Order.find({ customer_id: cust_id, company_id: cid })
      .select('order_code product_name qty total_amount status created_at')
      .sort({ created_at: -1 }).limit(50).lean(),
    Enquiry.find({ company_id: cid, retailer_mobile: customer.mobile })
      .select('enq_code product_name qty status created_at')
      .sort({ created_at: -1 }).limit(50).lean(),
    Receivable.find({ company_id: cid, customer_id: cust_id })
      .select('rcv_code order_id invoice_amount received outstanding status due_date created_at')
      .sort({ created_at: -1 }).limit(50).lean(),
  ]);

  // Tag each receivable with its order code (if the order still exists) so the
  // outstanding amount is always traceable — even when the order was removed.
  const orderById = new Map(orders.map(o => [String(o._id), o]));
  const receivableRows = receivables.map(r => ({
    ...r,
    order_code: r.order_id ? orderById.get(String(r.order_id))?.order_code || null : null,
    order_missing: !!r.order_id && !orderById.has(String(r.order_id)),
  }));

  const outstanding_amount = receivables
    .filter(r => r.status !== 'Received')
    .reduce((sum, r) => sum + (r.outstanding || 0), 0);

  sendSuccess(res, {
    ...customer,
    orders,
    enquiries,
    receivables: receivableRows,
    outstanding_amount,
  });
}

/** POST /api/customers */
async function createCustomer(req, res) {
  const { name, mobile } = req.body;
  if (!name || !mobile) return sendError(res, 'Name and mobile are required.');

  const customer = await Customer.create({
    company_id:   req.user.company_id,
    name,
    mobile,
    email:        req.body.email        || '',
    gst_number:   req.body.gst_number   || '',
    address:      req.body.address      || '',
    city:         req.body.city         || '',
    state:        req.body.state        || '',
    pincode:      req.body.pincode      || '',
    biz_type:     req.body.biz_type     || 'Retailer',
    credit_limit: req.body.credit_limit || 0,
    created_by:      req.user._id || req.user.id || null,
    created_by_name: req.user.name || '',
    created_by_type: 'Admin',
  });
  sendSuccess(res, customer, 'Customer created.', 201);
}

/** PUT /api/customers/:id */
async function updateCustomer(req, res) {
  const { name, mobile, email, gst_number, address, city, state, pincode, biz_type, credit_limit, is_active } = req.body;
  const update = {};
  if (name         !== undefined) update.name         = name;
  if (mobile       !== undefined) update.mobile       = mobile;
  if (email        !== undefined) update.email        = email;
  if (gst_number   !== undefined) update.gst_number   = gst_number;
  if (address      !== undefined) update.address      = address;
  if (city         !== undefined) update.city         = city;
  if (state        !== undefined) update.state        = state;
  if (pincode      !== undefined) update.pincode      = pincode;
  if (biz_type     !== undefined) update.biz_type     = biz_type;
  if (credit_limit !== undefined) update.credit_limit = credit_limit;
  if (is_active    !== undefined) update.is_active    = is_active;

  const customer = await Customer.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    update,
    { new: true }
  ).lean();
  if (!customer) return sendError(res, 'Customer not found.', 404);
  sendSuccess(res, customer, 'Customer updated.');
}

/** DELETE /api/customers/:id */
async function deleteCustomer(req, res) {
  const result = await Customer.deleteOne({ _id: req.params.id, company_id: req.user.company_id });
  if (result.deletedCount === 0) return sendError(res, 'Customer not found.', 404);
  sendSuccess(res, null, 'Customer deleted.');
}

module.exports = { listCustomers, getCustomer, createCustomer, updateCustomer, deleteCustomer };
