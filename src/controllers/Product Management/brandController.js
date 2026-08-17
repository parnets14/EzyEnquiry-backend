const { sendSuccess, sendError } = require('../../utils/helpers')
const Brand            = require('../../models/Product Management/Brand')
const resolveCompanyId = require('../../utils/resolveCompany')

/** GET /api/brands */
async function listBrands(req, res) {
  const company_id = await resolveCompanyId(req)
  if (!company_id) return sendError(res, 'No company found.', 400)

  const brands = await Brand.find({ company_id }).sort({ name: 1 }).lean()
  sendSuccess(res, brands)
}

/** POST /api/brands */
async function createBrand(req, res) {
  const company_id = await resolveCompanyId(req)
  if (!company_id) return sendError(res, 'No company found. Please register a company first.', 400)

  const { name, code, description } = req.body
  if (!name) return sendError(res, 'Brand name is required.')

  const brand = await Brand.create({
    company_id, name,
    code:        code        || '',
    description: description || '',
  })
  sendSuccess(res, brand, 'Brand created.', 201)
}

/** PUT /api/brands/:id */
async function updateBrand(req, res) {
  const company_id = await resolveCompanyId(req)
  if (!company_id) return sendError(res, 'No company found.', 400)

  const { name, code, description, is_active } = req.body
  const update = {}
  if (name        !== undefined) update.name        = name
  if (code        !== undefined) update.code        = code
  if (description !== undefined) update.description = description
  if (is_active   !== undefined) update.is_active   = is_active

  const brand = await Brand.findOneAndUpdate({ _id: req.params.id, company_id }, update, { new: true }).lean()
  if (!brand) return sendError(res, 'Brand not found.', 404)
  sendSuccess(res, brand, 'Brand updated.')
}

/** DELETE /api/brands/:id */
async function deleteBrand(req, res) {
  const company_id = await resolveCompanyId(req)
  if (!company_id) return sendError(res, 'No company found.', 400)

  const result = await Brand.deleteOne({ _id: req.params.id, company_id })
  if (result.deletedCount === 0) return sendError(res, 'Brand not found.', 404)
  sendSuccess(res, null, 'Brand deleted.')
}

module.exports = { listBrands, createBrand, updateBrand, deleteBrand }
