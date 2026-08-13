const express = require('express')
const { listFollowups, createFollowup, updateFollowup, deleteFollowup } = require('../controllers/crmController')

const router = express.Router()

router.get   ('/',    listFollowups)
router.post  ('/',    createFollowup)
router.put   ('/:id', updateFollowup)
router.delete('/:id', deleteFollowup)

module.exports = router
