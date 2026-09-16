/**
 * Gradient Calculation History Controller
 * Routes: GET /api/gradient-calc       — list (own company, paginated)
 *         POST /api/gradient-calc      — save a calculation
 *         DELETE /api/gradient-calc/:id — delete one record
 */
const GradientCalc = require('../../models/System Management/GradientCalc')

function sendSuccess(res, data, message = 'OK') {
  return res.status(200).json({ success: true, message, data })
}

// ── GET /api/gradient-calc ────────────────────────────────────────────────────
async function listCalculations(req, res) {
  const { page = 1, limit = 50 } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)

  // Super Admin sees all; everyone else scoped to their company
  const query = req.user.role === 'Super Admin'
    ? {}
    : req.user.company_id
      ? { company_id: req.user.company_id }
      : { created_by: req.user._id }

  const [total, records] = await Promise.all([
    GradientCalc.countDocuments(query),
    GradientCalc.find(query)
      .populate('created_by', 'name email')
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(parseInt(limit))
      .lean(),
  ])

  sendSuccess(res, {
    records,
    pagination: {
      total,
      page:       parseInt(page),
      limit:      parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit)),
    },
  })
}

// ── POST /api/gradient-calc ───────────────────────────────────────────────────
async function saveCalculation(req, res) {
  const {
    rise, run, input_mode, use_case, terrain,
    gradient_pct, angle_deg, ratio_n, slope_length, mm_per_metre,
    notes,
  } = req.body

  if (rise == null || run == null || gradient_pct == null) {
    return res.status(400).json({ success: false, message: 'rise, run and gradient_pct are required.' })
  }

  const record = await GradientCalc.create({
    company_id:   req.user.company_id || null,
    created_by:   req.user._id,
    rise:         Number(rise),
    run:          Number(run),
    input_mode:   input_mode || 'rise_run',
    use_case:     use_case   || 'Custom / General',
    terrain:      terrain    || 'Plain',
    gradient_pct: Number(gradient_pct),
    angle_deg:    Number(angle_deg)    || 0,
    ratio_n:      Number(ratio_n)      || 0,
    slope_length: Number(slope_length) || 0,
    mm_per_metre: Number(mm_per_metre) || 0,
    notes:        notes || '',
  })

  // Trim oldest beyond 200 records per company / user
  const trimQuery = req.user.company_id
    ? { company_id: req.user.company_id }
    : { created_by: req.user._id }

  const count = await GradientCalc.countDocuments(trimQuery)
  if (count > 200) {
    const oldest = await GradientCalc.find(trimQuery)
      .sort({ created_at: 1 })
      .limit(count - 200)
      .select('_id')
      .lean()
    await GradientCalc.deleteMany({ _id: { $in: oldest.map(o => o._id) } })
  }

  sendSuccess(res, record, 'Calculation saved.')
}

// ── DELETE /api/gradient-calc/:id ────────────────────────────────────────────
async function deleteCalculation(req, res) {
  const record = await GradientCalc.findById(req.params.id).lean()
  if (!record) return res.status(404).json({ success: false, message: 'Record not found.' })

  // Only owner or Super Admin can delete
  const isOwner   = String(record.created_by) === String(req.user._id)
  const isSuperAdmin = req.user.role === 'Super Admin'
  if (!isOwner && !isSuperAdmin) {
    return res.status(403).json({ success: false, message: 'Not authorised to delete this record.' })
  }

  await GradientCalc.findByIdAndDelete(req.params.id)
  sendSuccess(res, null, 'Record deleted.')
}

module.exports = { listCalculations, saveCalculation, deleteCalculation }
