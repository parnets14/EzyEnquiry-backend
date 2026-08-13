const express = require('express')
const { listSubscriptions, createSubscription, cancelSubscription } = require('../controllers/systemController')

const router = express.Router()

router.get   ('/',        listSubscriptions)
router.post  ('/',        createSubscription)
router.patch ('/:id/cancel', cancelSubscription)

module.exports = router
