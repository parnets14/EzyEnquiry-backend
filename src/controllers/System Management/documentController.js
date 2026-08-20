const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const Document = require('../../models/System Management/Document');

/** GET /api/documents */
async function listDocuments(req, res) {
  const { entity_type, entity_id, doc_type, page = 1, limit = 30 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const query  = { company_id: req.user.company_id };
  if (entity_type) query.entity_type = entity_type;
  if (entity_id)   query.entity_id   = entity_id;
  if (doc_type)    query.doc_type    = doc_type;

  const [total, documents] = await Promise.all([
    Document.countDocuments(query),
    Document.find(query)
      .populate('uploaded_by', 'name')
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(parseInt(limit))
      .lean(),
  ]);
  sendSuccess(res, { documents, pagination: paginate(total, parseInt(page), parseInt(limit)) });
}

/** POST /api/documents */
async function uploadDocument(req, res) {
  const { entity_type, entity_id, doc_type } = req.body;
  if (!req.files || req.files.length === 0) return sendError(res, 'No files uploaded.');
  if (!entity_type) return sendError(res, 'entity_type is required.');

  const inserted = [];
  for (const file of req.files) {
    const doc = await Document.create({
      company_id:  req.user.company_id,
      entity_type,
      entity_id:   entity_id || '',
      doc_type:    doc_type  || '',
      file_name:   file.filename,
      file_url:    `/uploads/documents/${file.filename}`,
      file_size:   file.size,
      mime_type:   file.mimetype,
      uploaded_by: req.user._id,
    });
    inserted.push(doc.toObject());
  }
  sendSuccess(res, { documents: inserted }, `${inserted.length} file(s) uploaded.`, 201);
}

/** DELETE /api/documents/:id */
async function deleteDocument(req, res) {
  const result = await Document.deleteOne({ _id: req.params.id, company_id: req.user.company_id });
  if (result.deletedCount === 0) return sendError(res, 'Document not found.', 404);
  sendSuccess(res, null, 'Document deleted.');
}

module.exports = { listDocuments, uploadDocument, deleteDocument };
