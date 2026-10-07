const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const Supplier = require('../../models/Purchase & Inventory Management/Supplier');

/**
 * GET /api/suppliers
 *
 * Supports optional pagination + search:
 *   ?page=1&limit=20&search=kajaria
 *
 * Back-compatible: when NO pagination params are sent the full supplier list is
 * returned as a bare array (the shape existing callers already expect). When
 * `page` or `limit` is supplied the response becomes
 * `{ suppliers, pagination }`, matching the canonical paginated controllers.
 */
async function listSuppliers(req, res) {
  const { search } = req.query;
  const wantsPaged = req.query.page !== undefined || req.query.limit !== undefined;

  const query = { company_id: req.user.company_id };
  if (search) {
    query.$or = [
      { name:       { $regex: search, $options: 'i' } },
      { mobile:     { $regex: search, $options: 'i' } },
      { city:       { $regex: search, $options: 'i' } },
      { gst_number: { $regex: search, $options: 'i' } },
    ];
  }

  if (!wantsPaged) {
    const suppliers = await Supplier.find(query).sort({ name: 1 }).lean();
    return sendSuccess(res, suppliers);
  }

  const page   = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit  = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 500);
  const offset = (page - 1) * limit;

  const [total, suppliers] = await Promise.all([
    Supplier.countDocuments(query),
    Supplier.find(query).sort({ name: 1 }).skip(offset).limit(limit).lean(),
  ]);

  sendSuccess(res, { suppliers, pagination: paginate(total, page, limit) });
}

/** GET /api/suppliers/:id */
async function getSupplier(req, res) {
  const supplier = await Supplier.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
  if (!supplier) return sendError(res, 'Supplier not found.', 404);
  sendSuccess(res, supplier);
}

/** POST /api/suppliers */
async function createSupplier(req, res) {
  const { name, mobile, email, gst_number, address, city, state, credit_days } = req.body;
  if (!name) return sendError(res, 'Supplier name is required.');

  const supplier = await Supplier.create({
    company_id:  req.user.company_id,
    name,
    mobile:      mobile      || '',
    email:       email       || '',
    gst_number:  gst_number  || '',
    address:     address     || '',
    city:        city        || '',
    state:       state       || '',
    credit_days: credit_days || 30,
  });
  sendSuccess(res, supplier, 'Supplier created.', 201);
}

/** PUT /api/suppliers/:id */
async function updateSupplier(req, res) {
  const { name, mobile, email, gst_number, address, city, state, credit_days, is_active } = req.body;
  const update = {};
  if (name        !== undefined) update.name        = name;
  if (mobile      !== undefined) update.mobile      = mobile;
  if (email       !== undefined) update.email       = email;
  if (gst_number  !== undefined) update.gst_number  = gst_number;
  if (address     !== undefined) update.address     = address;
  if (city        !== undefined) update.city        = city;
  if (state       !== undefined) update.state       = state;
  if (credit_days !== undefined) update.credit_days = credit_days;
  if (is_active   !== undefined) update.is_active   = is_active;

  const supplier = await Supplier.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    update,
    { new: true }
  ).lean();
  if (!supplier) return sendError(res, 'Supplier not found.', 404);
  sendSuccess(res, supplier, 'Supplier updated.');
}

/** DELETE /api/suppliers/:id */
async function deleteSupplier(req, res) {
  const result = await Supplier.deleteOne({ _id: req.params.id, company_id: req.user.company_id });
  if (result.deletedCount === 0) return sendError(res, 'Supplier not found.', 404);
  sendSuccess(res, null, 'Supplier deleted.');
}

module.exports = { listSuppliers, getSupplier, createSupplier, updateSupplier, deleteSupplier };
