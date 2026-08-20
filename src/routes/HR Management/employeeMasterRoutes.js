const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/HR Management/employeeMasterController');

// ── Departments ───────────────────────────────────────────────
router.get   ('/departments',      ctrl.listDepartments);
router.post  ('/departments',      ctrl.createDepartment);
router.put   ('/departments/:id',  ctrl.updateDepartment);
router.delete('/departments/:id',  ctrl.deleteDepartment);

// ── Designations ──────────────────────────────────────────────
router.get   ('/designations',     ctrl.listDesignations);
router.post  ('/designations',     ctrl.createDesignation);
router.put   ('/designations/:id', ctrl.updateDesignation);
router.delete('/designations/:id', ctrl.deleteDesignation);

module.exports = router;
