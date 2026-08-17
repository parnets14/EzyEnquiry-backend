const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Reports Management/dashboardController');

router.get('/', ctrl.getDashboardStats);

module.exports = router;
