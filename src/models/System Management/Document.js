const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema(
  {
    company_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
    entity_type: { type: String, default: '' },
    entity_id:   { type: String, default: '' },
    doc_type:    { type: String, default: '' },
    file_name:   { type: String, default: '' },
    file_url:    { type: String, default: '' },
    file_size:   { type: Number, default: 0 },
    mime_type:   { type: String, default: '' },
    uploaded_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: 'created_at' } }
);

documentSchema.index({ company_id: 1, entity_type: 1 });

module.exports = mongoose.model('Document', documentSchema);
