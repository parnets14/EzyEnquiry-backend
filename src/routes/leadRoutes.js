const express = require('express')
const { listLeads, createLead, updateLead, convertLead, deleteLead } = require('../controllers/crmController')

const router = express.Router()

router.get   ('/',             listLeads)
router.post  ('/',             createLead)
router.put   ('/:id',          updateLead)
router.patch ('/:id/convert',  convertLead)
router.delete('/:id',          deleteLead)

module.exports = router
