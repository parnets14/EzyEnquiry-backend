const { sendSuccess, sendError, paginate } = require('../utils/helpers')
const { Inventory }                        = require('../models')
const StockMovement                        = require('../models/StockMovement')

// ─────────────────────────────────────────────────────────────
// INVENTORY
// ─────────────────────────────────────────────────────────────

/** GET /api/inventory */
async function listInventory(req, res) {
  const { warehouse_id, low_stock, page = 1, limit = 50 } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)

  const [total, inventory] = await Promise.all([
    Inventory.count(req.user.company_id, { warehouse_id, low_stock: low_stock === 'true' }),
    Inventory.findAll(req.user.company_id, { warehouse_id, low_stock: low_stock === 'true', limit: parseInt(limit), offset }),
  ])

  sendSuccess(res, { inventory, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

/** GET /api/inventory/movements */
async function listStockMovements(req, res) {
  const { product_id, warehouse_id, movement_type, reference_type, page = 1, limit = 200 } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)

  const movements = await StockMovement.findAll(req.user.company_id, {
    product_id, warehouse_id, movement_type, reference_type,
    limit: parseInt(limit), offset,
  })

  sendSuccess(res, movements)
}

/** PATCH /api/inventory/adjust */
async function adjustStock(req, res) {
  const { product_id, warehouse_id, adjustment, notes } = req.body
  if (!product_id || adjustment === undefined) {
    return sendError(res, 'product_id and adjustment are required.')
  }

  const result = await Inventory.adjust(product_id, warehouse_id, adjustment)
  if (!result)       return sendError(res, 'Inventory record not found. Make sure a purchase has been done for this product in this warehouse first.', 404)
  if (result.error)  return sendError(res, result.error)

  sendSuccess(res, result, 'Stock adjusted.')
}

// ─────────────────────────────────────────────────────────────
// WAREHOUSES
// ─────────────────────────────────────────────────────────────

/** GET /api/inventory/warehouses */
async function listWarehouses(req, res) {
  const warehouses = await Inventory.findAllWarehouses(req.user.company_id)
  sendSuccess(res, warehouses)
}

/** GET /api/inventory/warehouses/:id */
async function getWarehouse(req, res) {
  const wh = await Inventory.findWarehouseById(req.params.id, req.user.company_id)
  if (!wh) return sendError(res, 'Warehouse not found.', 404)
  sendSuccess(res, wh)
}

/** GET /api/inventory/warehouses/:id/stock — warehouse with all its stock */
async function getWarehouseStock(req, res) {
  const result = await Inventory.getWarehouseWithStock(req.params.id, req.user.company_id)
  if (!result) return sendError(res, 'Warehouse not found.', 404)
  sendSuccess(res, result)
}

/** POST /api/inventory/warehouses */
async function createWarehouse(req, res) {
  const { name } = req.body
  if (!name || !name.trim()) return sendError(res, 'Warehouse name is required.')

  const wh = await Inventory.createWarehouse(req.user.company_id, req.body)
  sendSuccess(res, wh, 'Warehouse created.', 201)
}

/** PUT /api/inventory/warehouses/:id */
async function updateWarehouse(req, res) {
  const wh = await Inventory.updateWarehouse(req.params.id, req.user.company_id, req.body)
  if (!wh) return sendError(res, 'Warehouse not found.', 404)
  sendSuccess(res, wh, 'Warehouse updated.')
}

/** DELETE /api/inventory/warehouses/:id */
async function deleteWarehouse(req, res) {
  const result = await Inventory.deleteWarehouse(req.params.id, req.user.company_id)
  if (!result)       return sendError(res, 'Warehouse not found.', 404)
  if (result.error)  return sendError(res, result.error, 400)
  sendSuccess(res, null, 'Warehouse deleted.')
}

// ─────────────────────────────────────────────────────────────
// STOCK TRANSFERS
// ─────────────────────────────────────────────────────────────

/** GET /api/inventory/transfers */
async function listStockTransfers(req, res) {
  const { status, page = 1, limit = 50 } = req.query
  const { transfers, total } = await Inventory.findAllTransfers(req.user.company_id, {
    status, page: parseInt(page), limit: parseInt(limit),
  })
  sendSuccess(res, { transfers, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

/** GET /api/inventory/transfers/:id */
async function getStockTransfer(req, res) {
  const transfer = await Inventory.findTransferById(req.params.id, req.user.company_id)
  if (!transfer) return sendError(res, 'Transfer not found.', 404)
  sendSuccess(res, transfer)
}

/** POST /api/inventory/transfers */
async function createStockTransfer(req, res) {
  const { from_warehouse, to_warehouse, product_id, quantity } = req.body

  if (!from_warehouse || !to_warehouse || !product_id || !quantity) {
    return sendError(res, 'from_warehouse, to_warehouse, product_id and quantity are required.')
  }
  if (String(from_warehouse) === String(to_warehouse)) {
    return sendError(res, 'Source and destination warehouses must be different.')
  }
  if (parseFloat(quantity) <= 0) {
    return sendError(res, 'Quantity must be greater than 0.')
  }

  // Check sufficient stock in source warehouse
  const source = await Inventory.findByProduct(product_id, from_warehouse)
  if (!source || parseFloat(source.current_stock) < parseFloat(quantity)) {
    return sendError(res, `Insufficient stock in source warehouse. Available: ${source?.current_stock || 0}`)
  }

  const transfer = await Inventory.createTransfer(req.user.company_id, {
    ...req.body,
    transferred_by: req.user._id,
  })

  sendSuccess(res, transfer, 'Stock transfer initiated.', 201)
}

/** PATCH /api/inventory/transfers/:id/status — approve / mark in-transit / complete */
async function updateTransferStatus(req, res) {
  const { status } = req.body
  if (!status) return sendError(res, 'status is required.')

  const result = await Inventory.updateTransferStatus(
    req.params.id,
    req.user.company_id,
    status,
    req.user._id,
  )

  if (!result) return sendError(res, 'Transfer not found or invalid status.', 404)
  sendSuccess(res, result, `Transfer status updated to ${result.status}.`)
}

/** DELETE /api/inventory/transfers/:id */
async function deleteStockTransfer(req, res) {
  const result = await Inventory.deleteTransfer(req.params.id, req.user.company_id)
  if (!result)       return sendError(res, 'Transfer not found.', 404)
  if (result.error)  return sendError(res, result.error, 400)
  sendSuccess(res, null, 'Transfer deleted.')
}

module.exports = {
  // Inventory
  listInventory,
  adjustStock,
  listStockMovements,
  // Warehouses
  listWarehouses,
  getWarehouse,
  getWarehouseStock,
  createWarehouse,
  updateWarehouse,
  deleteWarehouse,
  // Transfers
  listStockTransfers,
  getStockTransfer,
  createStockTransfer,
  updateTransferStatus,
  deleteStockTransfer,
}
