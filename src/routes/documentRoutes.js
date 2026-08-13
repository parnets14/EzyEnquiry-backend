const express = require('express')
const { uploadDocs } = require('../middleware/upload')
const { listDocuments, uploadDocument, deleteDocument } = require('../controllers/systemController')

const router = express.Router()

router.get   ('/',    listDocuments)
router.post  ('/',    uploadDocs, uploadDocument)
router.delete('/:id', deleteDocument)

module.exports = router
