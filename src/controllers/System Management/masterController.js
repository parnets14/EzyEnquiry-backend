/**
 * Master List Controller — platform-wide standardized values (Super Admin manages,
 * everyone reads). Feeds the Wholesaler App "Add Product" dropdowns.
 */
const Master = require('../../models/System Management/Master')
const { sendSuccess, sendError } = require('../../utils/helpers')

const TYPES = ['category', 'sub_category', 'brand', 'finish', 'size', 'color', 'material', 'unit']

// GET /api/masters            → all active masters grouped by type
// GET /api/masters?type=finish → flat list of one type
async function listMasters(req, res) {
  const query = { is_active: true }
  if (req.query.type) query.type = req.query.type
  const rows = await Master.find(query).sort({ type: 1, sort: 1, name: 1 }).lean()

  if (req.query.type) return sendSuccess(res, { masters: rows })

  // Group by type for convenient consumption by the app.
  const grouped = {}
  for (const t of TYPES) grouped[t] = []
  for (const r of rows) {
    if (!grouped[r.type]) grouped[r.type] = []
    grouped[r.type].push({ _id: r._id, name: r.name, parent: r.parent })
  }
  sendSuccess(res, { masters: grouped })
}

// POST /api/masters   (Super Admin)  body: { type, name, parent?, sort? }
async function createMaster(req, res) {
  if (req.user.role !== 'Super Admin') return sendError(res, 'Access denied. Super Admin only.', 403)
  const { type, name, parent, sort } = req.body
  if (!type || !TYPES.includes(type)) return sendError(res, `type must be one of: ${TYPES.join(', ')}`)
  if (!name || !String(name).trim()) return sendError(res, 'name is required.')

  try {
    const doc = await Master.create({
      type, name: String(name).trim(), parent: parent || '', sort: parseInt(sort) || 0,
    })
    sendSuccess(res, doc.toObject(), 'Master value added.', 201)
  } catch (e) {
    if (e.code === 11000) return sendError(res, 'This value already exists for that type.', 409)
    throw e
  }
}

// PUT /api/masters/:id   (Super Admin)
async function updateMaster(req, res) {
  if (req.user.role !== 'Super Admin') return sendError(res, 'Access denied. Super Admin only.', 403)
  const update = {}
  ;['name', 'parent', 'is_active', 'sort'].forEach(f => { if (req.body[f] !== undefined) update[f] = req.body[f] })
  const doc = await Master.findByIdAndUpdate(req.params.id, update, { new: true }).lean()
  if (!doc) return sendError(res, 'Master value not found.', 404)
  sendSuccess(res, doc, 'Master value updated.')
}

// DELETE /api/masters/:id   (Super Admin) — soft-delete (deactivate)
async function deleteMaster(req, res) {
  if (req.user.role !== 'Super Admin') return sendError(res, 'Access denied. Super Admin only.', 403)
  const doc = await Master.findByIdAndUpdate(req.params.id, { is_active: false }, { new: true }).lean()
  if (!doc) return sendError(res, 'Master value not found.', 404)
  sendSuccess(res, { deleted: true }, 'Master value removed.')
}

module.exports = { listMasters, createMaster, updateMaster, deleteMaster, TYPES }
