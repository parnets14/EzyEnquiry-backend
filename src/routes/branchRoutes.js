const express = require('express')
const {
  listBranches, getBranch, createBranch, updateBranch, deleteBranch,
} = require('../controllers/branchController')

// This router is mounted under /api/companies/:companyId/branches
// req.params.companyId is forwarded via mergeParams: true
const router = express.Router({ mergeParams: true })

router.get   ('/',    listBranches)
router.get   ('/:id', getBranch)
router.post  ('/',    createBranch)
router.put   ('/:id', updateBranch)
router.delete('/:id', deleteBranch)

module.exports = router
