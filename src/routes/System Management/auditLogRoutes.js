const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/System Management/auditLogController');
const { authorize } = require('../../middleware/auth');

router.get('/', authorize('Super Admin', 'Company Owner'), ctrl.listAuditLogs);

module.exports = router;
