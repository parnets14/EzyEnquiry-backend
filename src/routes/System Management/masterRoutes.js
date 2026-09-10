/**
 * Master List Routes — Base: /api/masters (authenticate applied at mount)
 *   GET    /        list masters (all types grouped, or ?type=x)
 *   POST   /        add a value (Super Admin)
 *   PUT    /:id     update (Super Admin)
 *   DELETE /:id     deactivate (Super Admin)
 */
const express = require('express')
const router  = express.Router()
const ctrl    = require('../../controllers/System Management/masterController')

router.get('/',       ctrl.listMasters)
router.post('/',      ctrl.createMaster)
router.put('/:id',    ctrl.updateMaster)
router.delete('/:id', ctrl.deleteMaster)

module.exports = router
