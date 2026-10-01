const express = require('express');
const router  = express.Router();
const { allow } = require('../../middleware/roleGuard');
const { purchaseReportCtrl } = require('../../controllers/Purchase & Inventory Management/inventorySubController');

const roles = ['Company Owner', 'Manager', 'Accountant'];

router.get('/register',    allow(...roles), purchaseReportCtrl.purchaseRegister);
router.get('/supplier-wise',allow(...roles), purchaseReportCtrl.supplierWise);
router.get('/product-wise', allow(...roles), purchaseReportCtrl.productWise);
router.get('/pending-pos',  allow(...roles), purchaseReportCtrl.pendingPOs);
router.get('/grn',          allow(...roles), purchaseReportCtrl.grnReport);
router.get('/returns',      allow(...roles), purchaseReportCtrl.returnReport);
router.get('/outstanding',  allow(...roles), purchaseReportCtrl.supplierOutstanding);

module.exports = router;
