const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/System Management/documentController');
const { uploadDocs } = require('../../middleware/upload');

router.get   ('/',    ctrl.listDocuments);
router.post  ('/',    uploadDocs, ctrl.uploadDocument);
router.delete('/:id', ctrl.deleteDocument);

module.exports = router;
