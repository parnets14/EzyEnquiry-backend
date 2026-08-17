const express = require('express')
const { listDispatches, getDispatch, createDispatch, markInTransit, markDelivered, updateDispatch } = require('../controllers/dispatchController')

const router = express.Router()

router.get   ('/',                  listDispatches)
router.get   ('/:id',               getDispatch)
router.post  ('/',                  createDispatch)
router.patch ('/:id/intransit',     markInTransit)
router.patch ('/:id/deliver',       markDelivered)
router.put   ('/:id',               updateDispatch)

module.exports = router
