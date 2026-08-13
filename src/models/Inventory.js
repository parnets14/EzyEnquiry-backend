const mongoose = require('mongoose')

// ── Warehouse Schema ──────────────────────────────────────────
const warehouseSchema = new mongoose.Schema({
  company_id:        { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  warehouse_code:    { type: String, default: '' },          // Auto-generated: WH-0001
  name:              { type: String, required: true, trim: true },
  warehouse_type:    { type: String, default: '' },          // e.g. Main, Branch, Depot, Transit
  location:          { type: String, default: '' },
  address:           { type: String, default: '' },
  city:              { type: String, default: '' },
  state:             { type: String, default: '' },
  pincode:           { type: String, default: '' },
  contact_person:    { type: String, default: '' },          // Contact Person
  mobile:            { type: String, default: '' },
  email:             { type: String, default: '' },
  manager:           { type: String, default: '' },          // Warehouse Manager
  branch_id:         { type: mongoose.Schema.Types.ObjectId, default: null },
  capacity:          { type: Number, default: 0 },
  unit:              { type: String, default: 'Sq Ft' },
  is_active:         { type: Boolean, default: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })

warehouseSchema.index({ company_id: 1 })
const WarehouseModel = mongoose.model('Warehouse', warehouseSchema)

// ── Inventory Schema ──────────────────────────────────────────
const inventorySchema = new mongoose.Schema({
  company_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  product_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  warehouse_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', default: null },
  stock_in:        { type: Number, default: 0 },
  stock_out:       { type: Number, default: 0 },
  current_stock:   { type: Number, default: 0 },
  low_stock_alert: { type: Number, default: 50 },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })

inventorySchema.index({ company_id: 1 })
inventorySchema.index({ product_id: 1, warehouse_id: 1 }, { unique: true })
const InventoryModel = mongoose.model('Inventory', inventorySchema)

// ── Stock Transfer Schema ─────────────────────────────────────
const stockTransferSchema = new mongoose.Schema({
  company_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  from_warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse' },
  to_warehouse:   { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse' },
  product_id:     { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  quantity:       { type: Number, required: true },
  notes:          { type: String, default: '' },
  reason:         { type: String, default: '' },
  status:         { type: String, enum: ['Pending', 'In Transit', 'Completed', 'Cancelled'], default: 'Pending' },
  transferred_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approved_by:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } })

stockTransferSchema.index({ company_id: 1 })
const StockTransferModel = mongoose.model('StockTransfer', stockTransferSchema)

class Inventory {
  static async findAll(company_id, filters = {}) {
    const { warehouse_id, low_stock, limit = 50, offset = 0 } = filters
    const query = { company_id }
    if (warehouse_id)      query.warehouse_id = warehouse_id
    if (low_stock === true) query.$expr = { $lte: ['$current_stock', '$low_stock_alert'] }

    const docs = await InventoryModel.find(query)
      .populate({ path: 'product_id', select: 'code name unit brand_id category_id', populate: [{ path: 'brand_id', select: 'name' }, { path: 'category_id', select: 'name' }] })
      .populate('warehouse_id', 'name')
      .sort({ 'product_id.name': 1 })
      .skip(offset)
      .limit(limit)
      .lean()

    return docs.map(d => ({
      ...d,
      product_code:     d.product_id?.code          || '',
      product_name:     d.product_id?.name          || '',
      unit:             d.product_id?.unit          || '',
      brand_name:       d.product_id?.brand_id?.name    || '',
      category_name:    d.product_id?.category_id?.name || '',
      warehouse_name:   d.warehouse_id?.name        || '',
    }))
  }

  static async count(company_id, filters = {}) {
    const { warehouse_id, low_stock } = filters
    const query = { company_id }
    if (warehouse_id)      query.warehouse_id = warehouse_id
    if (low_stock === true) query.$expr = { $lte: ['$current_stock', '$low_stock_alert'] }
    return InventoryModel.countDocuments(query)
  }

  static async findByProduct(product_id, warehouse_id) {
    return InventoryModel.findOne({ product_id, warehouse_id }).lean()
  }

  static async upsertStockIn(company_id, product_id, warehouse_id, qty) {
    const qty_n = parseFloat(qty)
    return InventoryModel.findOneAndUpdate(
      { company_id, product_id, warehouse_id },
      {
        $setOnInsert: { company_id },
        $inc: { stock_in: qty_n, current_stock: qty_n },
      },
      { upsert: true, new: true }
    ).lean()
  }

  static async deductStock(product_id, company_id, qty, warehouse_id = null) {
    const qty_n = parseFloat(qty)
    const filter = { product_id, company_id }
    if (warehouse_id) filter.warehouse_id = warehouse_id
    return InventoryModel.findOneAndUpdate(
      filter,
      { $inc: { stock_out: qty_n, current_stock: -qty_n } },
      { new: true }
    ).lean()
  }

  static async adjust(product_id, warehouse_id, adjustment) {
    const inv = await this.findByProduct(product_id, warehouse_id)
    if (!inv) return null

    const newCurrent = parseFloat(inv.current_stock) + parseFloat(adjustment)
    if (newCurrent < 0) return { error: 'Insufficient stock' }

    const inc = {}
    if (parseFloat(adjustment) > 0) inc.stock_in  = parseFloat(adjustment)
    if (parseFloat(adjustment) < 0) inc.stock_out = Math.abs(parseFloat(adjustment))

    return InventoryModel.findOneAndUpdate(
      { product_id, warehouse_id },
      { $set: { current_stock: newCurrent }, $inc: inc },
      { new: true }
    ).lean()
  }

  // ── Warehouses ─────────────────────────────────────────────
  static async findAllWarehouses(company_id) {
    return WarehouseModel.find({ company_id }).sort({ name: 1 }).lean()
  }

  static async findWarehouseById(id, company_id) {
    return WarehouseModel.findOne({ _id: id, company_id }).lean()
  }

  static async createWarehouse(company_id, data) {
    const {
      warehouse_code, name, warehouse_type, location, city, state, address, pincode,
      contact_person, mobile, email, manager, branch_id, capacity, unit,
    } = data

    const wh = await WarehouseModel.create({
      company_id,
      warehouse_code: warehouse_code || '',
      name,
      warehouse_type:  warehouse_type  || '',
      location:        location        || city || '',
      city:            city            || '',
      state:           state           || '',
      address:         address         || '',
      pincode:         pincode         || '',
      contact_person:  contact_person  || '',
      mobile:          mobile          || '',
      email:           email           || '',
      manager:         manager         || '',
      branch_id:       branch_id       || null,
      capacity:        capacity        || 0,
      unit:            unit            || 'Sq Ft',
    })
    return wh.toObject()
  }

  static async updateWarehouse(id, company_id, data) {
    const {
      warehouse_code, name, warehouse_type, location, city, state, address, pincode,
      contact_person, mobile, email, manager, capacity, unit, is_active,
    } = data
    return WarehouseModel.findOneAndUpdate(
      { _id: id, company_id },
      {
        warehouse_code:  warehouse_code  || '',
        name,
        warehouse_type:  warehouse_type  || '',
        location:        location        || city || '',
        city:            city            || '',
        state:           state           || '',
        address:         address         || '',
        pincode:         pincode         || '',
        contact_person:  contact_person  || '',
        mobile:          mobile          || '',
        email:           email           || '',
        manager:         manager         || '',
        capacity:        capacity        || 0,
        unit:            unit            || 'Sq Ft',
        is_active:       is_active !== false,
      },
      { new: true }
    ).lean()
  }

  static async deleteWarehouse(id, company_id) {
    // Check if any inventory exists for this warehouse
    const hasInventory = await InventoryModel.findOne({ warehouse_id: id }).lean()
    if (hasInventory) return { error: 'Cannot delete warehouse with existing inventory records.' }
    const result = await WarehouseModel.deleteOne({ _id: id, company_id })
    return result.deletedCount > 0
  }

  // ── Warehouse with stock summary ───────────────────────────
  static async getWarehouseWithStock(id, company_id) {
    const wh = await WarehouseModel.findOne({ _id: id, company_id }).lean()
    if (!wh) return null

    const stock = await InventoryModel.find({ warehouse_id: id, company_id })
      .populate({ path: 'product_id', select: 'code name unit' })
      .lean()

    const stockList = stock.map(s => ({
      ...s,
      product_name: s.product_id?.name || '',
      product_code: s.product_id?.code || '',
      unit:         s.product_id?.unit || '',
    }))

    return { ...wh, stock: stockList }
  }

  // ── Stock Transfers ────────────────────────────────────────
  static async findAllTransfers(company_id, filters = {}) {
    const { status, page = 1, limit = 50 } = filters
    const offset = (parseInt(page) - 1) * parseInt(limit)

    const query = { company_id }
    if (status && status !== 'All') query.status = status

    const [total, docs] = await Promise.all([
      StockTransferModel.countDocuments(query),
      StockTransferModel.find(query)
        .populate('product_id', 'name code unit')
        .populate('from_warehouse', 'name city')
        .populate('to_warehouse', 'name city')
        .populate('transferred_by', 'name')
        .sort({ created_at: -1 })
        .skip(offset)
        .limit(parseInt(limit))
        .lean(),
    ])

    const transfers = docs.map(d => ({
      ...d,
      product_name:        d.product_id?.name    || '',
      product_code:        d.product_id?.code    || '',
      product_unit:        d.product_id?.unit    || '',
      from_warehouse_name: d.from_warehouse?.name || '',
      from_warehouse_city: d.from_warehouse?.city || '',
      to_warehouse_name:   d.to_warehouse?.name   || '',
      to_warehouse_city:   d.to_warehouse?.city   || '',
      transferred_by_name: d.transferred_by?.name || '',
    }))

    return { transfers, total }
  }

  static async findTransferById(id, company_id) {
    const doc = await StockTransferModel.findOne({ _id: id, company_id })
      .populate('product_id', 'name code unit')
      .populate('from_warehouse', 'name city')
      .populate('to_warehouse', 'name city')
      .populate('transferred_by', 'name')
      .lean()
    if (!doc) return null
    return {
      ...doc,
      product_name:        doc.product_id?.name    || '',
      product_code:        doc.product_id?.code    || '',
      from_warehouse_name: doc.from_warehouse?.name || '',
      to_warehouse_name:   doc.to_warehouse?.name   || '',
      transferred_by_name: doc.transferred_by?.name || '',
    }
  }

  static async createTransfer(company_id, data) {
    const { from_warehouse, to_warehouse, product_id, quantity, notes, reason, transferred_by } = data
    const qty_n = parseFloat(quantity)

    // Deduct from source warehouse
    await InventoryModel.findOneAndUpdate(
      { product_id, warehouse_id: from_warehouse },
      { $inc: { stock_out: qty_n, current_stock: -qty_n } }
    )

    // Add to destination warehouse (upsert if new product)
    await InventoryModel.findOneAndUpdate(
      { product_id, warehouse_id: to_warehouse },
      {
        $setOnInsert: { company_id },
        $inc: { stock_in: qty_n, current_stock: qty_n },
      },
      { upsert: true, new: true }
    )

    const transfer = await StockTransferModel.create({
      company_id, from_warehouse, to_warehouse,
      product_id, quantity: qty_n,
      notes:  notes  || '',
      reason: reason || '',
      status: 'Pending',
      transferred_by,
    })
    return transfer.toObject()
  }

  static async updateTransferStatus(id, company_id, status, approved_by) {
    const validStatuses = ['Pending', 'In Transit', 'Completed', 'Cancelled']
    if (!validStatuses.includes(status)) return null

    const update = { status }
    if (approved_by) update.approved_by = approved_by

    // If cancelling, reverse the stock movement
    if (status === 'Cancelled') {
      const transfer = await StockTransferModel.findOne({ _id: id, company_id }).lean()
      if (transfer && transfer.status !== 'Cancelled' && transfer.status !== 'Completed') {
        const qty_n = parseFloat(transfer.quantity)
        // Restore source warehouse stock
        await InventoryModel.findOneAndUpdate(
          { product_id: transfer.product_id, warehouse_id: transfer.from_warehouse },
          { $inc: { stock_out: -qty_n, current_stock: qty_n } }
        )
        // Deduct destination warehouse stock
        await InventoryModel.findOneAndUpdate(
          { product_id: transfer.product_id, warehouse_id: transfer.to_warehouse },
          { $inc: { stock_in: -qty_n, current_stock: -qty_n } }
        )
      }
    }

    return StockTransferModel.findOneAndUpdate(
      { _id: id, company_id },
      update,
      { new: true }
    ).lean()
  }

  static async deleteTransfer(id, company_id) {
    const transfer = await StockTransferModel.findOne({ _id: id, company_id }).lean()
    if (!transfer) return false
    if (transfer.status === 'Completed') return { error: 'Cannot delete a completed transfer.' }

    // If it was already deducted (Pending or In Transit), reverse stock
    if (['Pending', 'In Transit'].includes(transfer.status)) {
      const qty_n = parseFloat(transfer.quantity)
      await InventoryModel.findOneAndUpdate(
        { product_id: transfer.product_id, warehouse_id: transfer.from_warehouse },
        { $inc: { stock_out: -qty_n, current_stock: qty_n } }
      )
      await InventoryModel.findOneAndUpdate(
        { product_id: transfer.product_id, warehouse_id: transfer.to_warehouse },
        { $inc: { stock_in: -qty_n, current_stock: -qty_n } }
      )
    }

    const result = await StockTransferModel.deleteOne({ _id: id, company_id })
    return result.deletedCount > 0
  }
}

module.exports = Inventory
module.exports.InventoryModel    = InventoryModel
module.exports.WarehouseModel    = WarehouseModel
module.exports.StockTransferModel = StockTransferModel
