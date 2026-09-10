const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Product Management/productController');
const { authorize } = require('../../middleware/auth');
const { uploadImages } = require('../../middleware/upload');
const { MODULES, moduleAccess } = require('../../config/permissions');

const handleUpload = (req, res, next) =>
  uploadImages(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    next();
  });

const guard = moduleAccess(MODULES.PRODUCTS);

// ── Unguarded (auth + company only) ───────────────────────────
router.get   ('/for-select',  ctrl.productsForSelect);   // used by quotation/invoice dropdowns

// ── Guarded by PRODUCTS module access ─────────────────────────
router.get   ('/search',      guard, ctrl.searchProducts);
router.get   ('/recycle-bin', guard, ctrl.getRecycleBin);
router.get   ('/admin/all',   authorize('Super Admin'), ctrl.listAllProducts);
router.get   ('/admin/company/:companyId/taxonomy', authorize('Super Admin'), ctrl.getCompanyTaxonomy);
router.get   ('/admin/product/:productId/taxonomy', authorize('Super Admin'), ctrl.getProductTaxonomy);
router.get   ('/:id/check-transactions', guard, ctrl.checkProductTransactions);
router.get   ('/',            guard, ctrl.listProducts);
router.get   ('/:id',         guard, ctrl.getProduct);
router.post  ('/:id/restore', guard, ctrl.restoreProduct);
router.post  ('/',            guard, handleUpload, ctrl.createProduct);
router.put   ('/:id',         guard, handleUpload, ctrl.updateProduct);
router.delete('/:id',         guard, ctrl.deleteProduct);

module.exports = router;
