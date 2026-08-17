const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Finance Management/saleController');

router.get ('/', ctrl.listSales);
router.post('/', ctrl.createSale);

module.exports = router;
