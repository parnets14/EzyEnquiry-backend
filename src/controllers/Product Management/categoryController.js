const { sendSuccess, sendError } = require('../../utils/helpers')
const Category         = require('../../models/Product Management/Category')
const Product          = require('../../models/Product Management/Product')
const resolveCompanyId = require('../../utils/resolveCompany')
const mongoose         = require('mongoose')

// ── Categories ────────────────────────────────────────────────

/** GET /api/categories */
async function listCategories(req, res) {
  const company_id = await resolveCompanyId(req)
  if (!company_id) return sendError(res, 'No company found. Please register a company first.', 400)

  // Only top-level categories (parent_id is null)
  const categories = await Category.find({ company_id, parent_id: null }).sort({ name: 1 }).lean()

  // Attach product count per category
  const catIds = categories.map(c => c._id)
  const counts = await Product.aggregate([
    { $match: { company_id: new mongoose.Types.ObjectId(company_id), category_id: { $in: catIds } } },
    { $group: { _id: '$category_id', count: { $sum: 1 } } },
  ])
  const countMap = {}
  counts.forEach(r => { countMap[r._id.toString()] = r.count })

  const result = categories.map(c => ({ ...c, product_count: countMap[c._id.toString()] || 0 }))
  sendSuccess(res, result)
}

/** POST /api/categories */
async function createCategory(req, res) {
  const company_id = await resolveCompanyId(req)
  if (!company_id) return sendError(res, 'No company found. Please register a company first.', 400)

  const { name, code, description } = req.body
  if (!name) return sendError(res, 'Category name is required.')

  const category = await Category.create({
    company_id, name,
    code:        code        || '',
    parent_id:   null,
    description: description || '',
  })
  sendSuccess(res, category, 'Category created.', 201)
}

/** PUT /api/categories/:id */
async function updateCategory(req, res) {
  const company_id = await resolveCompanyId(req)
  if (!company_id) return sendError(res, 'No company found.', 400)

  const { name, code, description, is_active } = req.body
  const update = {}
  if (name        !== undefined) update.name        = name
  if (code        !== undefined) update.code        = code
  if (description !== undefined) update.description = description
  if (is_active   !== undefined) update.is_active   = is_active

  const category = await Category.findOneAndUpdate({ _id: req.params.id, company_id }, update, { new: true }).lean()
  if (!category) return sendError(res, 'Category not found.', 404)
  sendSuccess(res, category, 'Category updated.')
}

/** DELETE /api/categories/:id */
async function deleteCategory(req, res) {
  const company_id = await resolveCompanyId(req)
  if (!company_id) return sendError(res, 'No company found.', 400)

  const childCount = await Category.countDocuments({ company_id, parent_id: req.params.id })
  if (childCount > 0) return sendError(res, 'Cannot delete: category has sub-categories. Delete them first.', 400)

  const result = await Category.deleteOne({ _id: req.params.id, company_id })
  if (result.deletedCount === 0) return sendError(res, 'Category not found.', 404)
  sendSuccess(res, null, 'Category deleted.')
}

// ── Sub-Categories ────────────────────────────────────────────

/** GET /api/sub-categories */
async function listSubCategories(req, res) {
  const company_id = await resolveCompanyId(req)
  if (!company_id) return sendError(res, 'No company found.', 400)

  const query = { company_id, parent_id: { $ne: null } }
  if (req.query.categoryId) query.parent_id = req.query.categoryId

  const subs = await Category.find(query).sort({ name: 1 }).lean()

  // Attach parent category name
  const parentIds = [...new Set(subs.map(s => s.parent_id?.toString()).filter(Boolean))]
  const parentMap = {}
  if (parentIds.length) {
    const parents = await Category.find({ _id: { $in: parentIds } }).lean()
    parents.forEach(p => { parentMap[p._id.toString()] = p.name })
  }

  const result = subs.map(s => ({ ...s, category_name: parentMap[s.parent_id?.toString()] || null }))
  sendSuccess(res, result)
}

/** POST /api/sub-categories */
async function createSubCategory(req, res) {
  const company_id = await resolveCompanyId(req)
  if (!company_id) return sendError(res, 'No company found. Please register a company first.', 400)

  const { category_id, name, code, description, is_active } = req.body
  if (!category_id) return sendError(res, 'Category is required.')
  if (!name)        return sendError(res, 'Sub-category name is required.')
  if (!code)        return sendError(res, 'Sub-category code is required.')

  const parent = await Category.findOne({ _id: category_id, company_id }).lean()
  if (!parent)          return sendError(res, 'Selected category not found.', 404)
  if (!parent.is_active) return sendError(res, 'Selected category is inactive.', 400)
  if (parent.parent_id)  return sendError(res, 'Cannot create a sub-category under another sub-category.', 400)

  const duplicate = await Category.findOne({
    company_id, parent_id: category_id,
    name: { $regex: `^${name.trim()}$`, $options: 'i' },
  }).lean()
  if (duplicate) return sendError(res, `Sub-category "${name}" already exists for this category.`, 409)

  const sub = await Category.create({
    company_id,
    name:        name.trim(),
    code:        code.trim(),
    parent_id:   category_id,
    description: description || '',
    is_active:   is_active !== false,
  })
  sendSuccess(res, sub, 'Sub-category created.', 201)
}

/** PUT /api/sub-categories/:id */
async function updateSubCategory(req, res) {
  const company_id = await resolveCompanyId(req)
  if (!company_id) return sendError(res, 'No company found.', 400)

  const { category_id, name, code, description, is_active } = req.body
  const sub = await Category.findOne({ _id: req.params.id, company_id }).lean()
  if (!sub) return sendError(res, 'Sub-category not found.', 404)

  // Validate new parent if being changed
  const newParentId = category_id || sub.parent_id?.toString()
  if (category_id && category_id !== sub.parent_id?.toString()) {
    const parent = await Category.findOne({ _id: category_id, company_id }).lean()
    if (!parent)          return sendError(res, 'Selected category not found.', 404)
    if (!parent.is_active) return sendError(res, 'Selected category is inactive.', 400)
    if (parent.parent_id)  return sendError(res, 'Cannot move sub-category under another sub-category.', 400)
  }

  // Duplicate name check (exclude self)
  if (name) {
    const duplicate = await Category.findOne({
      _id: { $ne: req.params.id }, company_id, parent_id: newParentId,
      name: { $regex: `^${name.trim()}$`, $options: 'i' },
    }).lean()
    if (duplicate) return sendError(res, `Sub-category "${name}" already exists for this category.`, 409)
  }

  const update = {}
  if (name        !== undefined) update.name        = name.trim()
  if (code        !== undefined) update.code        = code.trim()
  if (description !== undefined) update.description = description
  if (category_id !== undefined) update.parent_id   = category_id
  if (is_active   !== undefined) update.is_active   = is_active

  const updated = await Category.findOneAndUpdate({ _id: req.params.id, company_id }, update, { new: true }).lean()
  sendSuccess(res, updated, 'Sub-category updated.')
}

/** DELETE /api/sub-categories/:id */
async function deleteSubCategory(req, res) {
  const company_id = await resolveCompanyId(req)
  if (!company_id) return sendError(res, 'No company found.', 400)

  const sub = await Category.findOne({ _id: req.params.id, company_id }).lean()
  if (!sub)          return sendError(res, 'Sub-category not found.', 404)
  if (!sub.parent_id) return sendError(res, 'Use the category delete endpoint for top-level categories.', 400)

  await Category.deleteOne({ _id: req.params.id, company_id })
  sendSuccess(res, null, 'Sub-category deleted.')
}

module.exports = {
  listCategories, createCategory, updateCategory, deleteCategory,
  listSubCategories, createSubCategory, updateSubCategory, deleteSubCategory,
}
