const express = require('express')
const {
  listDepartments, createDepartment, updateDepartment, deleteDepartment,
  listDesignations, createDesignation, updateDesignation, deleteDesignation,
} = require('../controllers/employeeMasterController')

const router = express.Router()

// ── Departments ───────────────────────────────────────────────
router.get   ('/departments',         listDepartments)
router.post  ('/departments',         createDepartment)
router.put   ('/departments/:id',     updateDepartment)
router.delete('/departments/:id',     deleteDepartment)

// ── Designations ──────────────────────────────────────────────
router.get   ('/designations',        listDesignations)
router.post  ('/designations',        createDesignation)
router.put   ('/designations/:id',    updateDesignation)
router.delete('/designations/:id',    deleteDesignation)

module.exports = router
