const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Product Management/productController');
const { authorize } = require('../../middleware/auth');
const { uploadImages } = require('../../middleware/upload');

const handleUpload = (req, res, next) =>
  uploadImages(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    next();
  });

router.get   ('/search',      ctrl.searchProducts);
router.get   ('/recycle-bin', ctrl.getRecycleBin);
router.get   ('/admin/all',   authorize('Super Admin'), ctrl.listAllProducts);
router.get   ('/admin/company/:companyId/taxonomy', authorize('Super Admin'), ctrl.getCompanyTaxonomy);
router.get   ('/admin/product/:productId/taxonomy', authorize('Super Admin'), ctrl.getProductTaxonomy);
router.get   ('/:id/check-transactions', ctrl.checkProductTransactions);
router.get   ('/',            ctrl.listProducts);
router.get   ('/:id',         ctrl.getProduct);
router.post  ('/:id/restore', ctrl.restoreProduct);
router.post  ('/',            handleUpload, ctrl.createProduct);
router.put   ('/:id',         handleUpload, ctrl.updateProduct);
router.delete('/:id',         ctrl.deleteProduct);

module.exports = router;
