const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Purchase & Inventory Management/stockTransferController');

router.get   ('/',              ctrl.listStockTransfers);
router.get   ('/:id',           ctrl.getStockTransfer);
router.post  ('/',              ctrl.createStockTransfer);
router.patch ('/:id/status',    ctrl.updateTransferStatus);
router.delete('/:id',           ctrl.deleteStockTransfer);

module.exports = router;
