const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Finance Management/profitLossController');

router.get('/', ctrl.getProfitLoss);

module.exports = router;
