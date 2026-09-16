const express = require('express')
const router  = express.Router()
const ctrl    = require('../../controllers/System Management/gradientCalcController')

router.get   ('/',    ctrl.listCalculations)
router.post  ('/',    ctrl.saveCalculation)
router.delete('/:id', ctrl.deleteCalculation)

module.exports = router
