const { sendSuccess, sendError } = require('../../utils/helpers');
const Supplier = require('../../models/Purchase & Inventory Management/Supplier');

/** GET /api/suppliers */
async function listSuppliers(req, res) {
  const suppliers = await Supplier.find({ company_id: req.user.company_id }).sort({ name: 1 }).lean();
  sendSuccess(res, suppliers);
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
