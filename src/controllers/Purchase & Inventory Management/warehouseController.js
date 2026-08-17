const { sendSuccess, sendError } = require('../../utils/helpers');
const Warehouse = require('../../models/Purchase & Inventory Management/Warehouse');
const Inventory = require('../../models/Purchase & Inventory Management/Inventory');

// ── Helper: generate next warehouse code ─────────────────────
async function getNextWarehouseCode(company_id) {
  const count = await Warehouse.countDocuments({ company_id });
  return `WH-${String(count + 1).padStart(4, '0')}`;
}

/** GET /api/warehouses */
async function listWarehouses(req, res) {
  const warehouses = await Warehouse.find({ company_id: req.user.company_id }).sort({ name: 1 }).lean();
  sendSuccess(res, warehouses);
}

/** GET /api/warehouses/:id */
async function getWarehouse(req, res) {
  const warehouse = await Warehouse.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
  if (!warehouse) return sendError(res, 'Warehouse not found.', 404);
  sendSuccess(res, warehouse);
}

/** GET /api/warehouses/:id/stock */
async function getWarehouseStock(req, res) {
  const warehouse = await Warehouse.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
  if (!warehouse) return sendError(res, 'Warehouse not found.', 404);

  const stock = await Inventory.find({ warehouse_id: req.params.id, company_id: req.user.company_id })
    .populate({ path: 'product_id', select: 'code name unit' })
    .lean();

  const stockList = stock.map(s => ({
    ...s,
    product_name: s.product_id?.name || '',
    product_code: s.product_id?.code || '',
    unit:         s.product_id?.unit || '',
  }));

  sendSuccess(res, { ...warehouse, stock: stockList });
}

/** POST /api/warehouses */
async function createWarehouse(req, res) {
  const { name, warehouse_type, location, address, city, state, pincode, contact_person, mobile, email, manager, branch_id, capacity, unit } = req.body;
  if (!name?.trim()) return sendError(res, 'Warehouse name is required.');

  const warehouse_code = await getNextWarehouseCode(req.user.company_id);
  const warehouse = await Warehouse.create({
    company_id: req.user.company_id,
    warehouse_code,
    name,
    warehouse_type:  warehouse_type  || '',
    location:        location        || city || '',
    address:         address         || '',
    city:            city            || '',
    state:           state           || '',
    pincode:         pincode         || '',
    contact_person:  contact_person  || '',
    mobile:          mobile          || '',
    email:           email           || '',
    manager:         manager         || '',
    branch_id:       branch_id       || null,
    capacity:        capacity        || 0,
    unit:            unit            || 'Sq Ft',
  });
  sendSuccess(res, warehouse, 'Warehouse created.', 201);
}

/** PUT /api/warehouses/:id */
async function updateWarehouse(req, res) {
  const { name, warehouse_type, location, address, city, state, pincode, contact_person, mobile, email, manager, capacity, unit, is_active } = req.body;
  const update = {};
  if (name           !== undefined) update.name           = name;
  if (warehouse_type !== undefined) update.warehouse_type = warehouse_type;
  if (location       !== undefined) update.location       = location;
  if (address        !== undefined) update.address        = address;
  if (city           !== undefined) update.city           = city;
  if (state          !== undefined) update.state          = state;
  if (pincode        !== undefined) update.pincode        = pincode;
  if (contact_person !== undefined) update.contact_person = contact_person;
  if (mobile         !== undefined) update.mobile         = mobile;
  if (email          !== undefined) update.email          = email;
  if (manager        !== undefined) update.manager        = manager;
  if (capacity       !== undefined) update.capacity       = capacity;
  if (unit           !== undefined) update.unit           = unit;
  if (is_active      !== undefined) update.is_active      = is_active;

  const warehouse = await Warehouse.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    update,
    { new: true }
  ).lean();
  if (!warehouse) return sendError(res, 'Warehouse not found.', 404);
  sendSuccess(res, warehouse, 'Warehouse updated.');
}

/** DELETE /api/warehouses/:id */
async function deleteWarehouse(req, res) {
  const hasInventory = await Inventory.findOne({ warehouse_id: req.params.id }).lean();
  if (hasInventory) return sendError(res, 'Cannot delete warehouse with existing inventory records.', 400);

  const result = await Warehouse.deleteOne({ _id: req.params.id, company_id: req.user.company_id });
  if (result.deletedCount === 0) return sendError(res, 'Warehouse not found.', 404);
  sendSuccess(res, null, 'Warehouse deleted.');
}

module.exports = { listWarehouses, getWarehouse, getWarehouseStock, createWarehouse, updateWarehouse, deleteWarehouse };
