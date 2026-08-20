const express    = require('express');
const router     = express.Router();
const ctrl       = require('../../controllers/Reports Management/reportController');
const dashCtrl   = require('../../controllers/Reports Management/dashboardController');

router.get('/dashboard',  dashCtrl.getDashboardStats);
router.get('/sales',      ctrl.getSalesReport);
router.get('/purchases',  ctrl.getPurchaseReport);
router.get('/expenses',   ctrl.getExpenseReport);
router.get('/customers',  ctrl.getCustomerReport);
router.get('/suppliers',  ctrl.getSupplierReport);
router.get('/inventory',  ctrl.getInventoryReport);
router.get('/employees',  ctrl.getEmployeeReport);

module.exports = router;
