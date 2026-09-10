/**
 * staffDataRoutes.js
 *
 * Read + light-write endpoints for the Staff mobile app, mounted at /api/staff.
 * These reuse the existing company-scoped controllers so a staff member can see
 * the company's data and perform lightweight actions (record payment, add customer,
 * create quotation) without needing full CRM module permissions.
 *
 * Auth: the parent router already applies `authenticate` + `requireCompany`,
 * so every controller here is scoped by req.user.company_id.
 */
const express = require('express');
const router  = express.Router();

const orderCtrl        = require('../../controllers/Marketplace Management/orderController');
const dispatchCtrl     = require('../../controllers/Marketplace Management/dispatchController');
const invoiceCtrl      = require('../../controllers/Finance Management/invoiceController');
const customerCtrl     = require('../../controllers/CRM Management/customerController');
const quotationCtrl    = require('../../controllers/Finance Management/quotationController');
const notificationCtrl = require('../../controllers/System Management/notificationController');

// Mark every request through this router as a staff-app request.
// This lets shared controllers (e.g. listOrders) know to apply
// staff-specific filters (only show orders assigned to req.user).
router.use((req, _res, next) => {
  req.isStaffApp = true;
  next();
});

// ── Sales Orders (read) ──────────────────────────────────────
router.get('/orders',     orderCtrl.listOrders);
router.get('/orders/:id', orderCtrl.getOrder);

// ── Dispatches (read) ────────────────────────────────────────
router.get('/dispatches',     dispatchCtrl.listDispatches);
router.get('/dispatches/:id', dispatchCtrl.getDispatch);

// ── Invoices (read + record payment + verify collection OTP) ─
router.get ('/invoices',                              invoiceCtrl.listInvoices);
router.get ('/invoices/summary',                      invoiceCtrl.getInvoiceSummary);
router.get ('/invoices/:id',                          invoiceCtrl.getInvoice);
router.post('/invoices/:id/payment',                  invoiceCtrl.recordPayment);
router.post('/invoices/:id/payment/:phId/verify',     invoiceCtrl.verifyPayment);

// ── Customers (list + create) ─────────────────────────────────
router.get ('/customers',     customerCtrl.listCustomers);
router.get ('/customers/:id', customerCtrl.getCustomer);
router.post('/customers',     customerCtrl.createCustomer);

// ── Quotations (list + create) ────────────────────────────────
router.get ('/quotations',     quotationCtrl.listQuotations);
router.get ('/quotations/:id', quotationCtrl.getQuotation);
router.post('/quotations',     quotationCtrl.createQuotation);

// ── Products (catalog — read-only search) ─────────────────────
// Returns all active, non-deleted products with full brand/category population.
// No company filter — staff can see all products to create quotations.
router.get('/products', async (req, res) => {
  try {
    const Product  = require('../../models/Product Management/Product');
    const { paginate } = require('../../utils/helpers');

    const { search = '', page = 1, limit = 500 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    // No company_id filter — return all active products so staff can browse
    // the full catalogue regardless of which company created each product.
    const query = {
      is_active: { $ne: false },
      status:    { $ne: 'deleted' },
    };

    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { name: regex }, { code: regex }, { alias: regex },
        { size: regex }, { finish: regex }, { color: regex },
        { design: regex }, { collection: regex },
      ];
    }

    const [total, products] = await Promise.all([
      Product.countDocuments(query),
      Product.find(query)
        .populate('brand_id',        'name code')
        .populate('category_id',     'name code')
        .populate('sub_category_id', 'name code')
        .populate('company_id',      'name biz_type')
        .sort({ featured: -1, new_arrival: -1, name: 1 })
        .skip(offset)
        .limit(parseInt(limit))
        .lean(),
    ]);

    // Join live inventory so the Staff App can show real available stock next
    // to each product (the app already renders `p.stock`). We sum available
    // stock across warehouses per product; fall back to current_stock for
    // legacy records.
    const Inventory = require('../../models/Purchase & Inventory Management/Inventory');
    const productIds = products.map(p => p._id);
    const stockByProduct = new Map();
    if (productIds.length) {
      const invRows = await Inventory.aggregate([
        { $match: { product_id: { $in: productIds } } },
        {
          $group: {
            _id: '$product_id',
            available: { $sum: { $max: ['$available_stock', '$current_stock'] } },
            physical:  { $sum: { $max: ['$physical_stock',  '$current_stock'] } },
          },
        },
      ]);
      invRows.forEach(r => stockByProduct.set(String(r._id), r));
    }
    const withStock = products.map(p => {
      const s = stockByProduct.get(String(p._id));
      return {
        ...p,
        available_stock: s ? Math.max(s.available, 0) : 0,
        physical_stock:  s ? Math.max(s.physical, 0)  : 0,
        current_stock:   s ? Math.max(s.available, 0) : 0, // legacy mirror for the app
      };
    });

    console.log(`[Staff Products] company=${req.user.company_id} total_all=${total} returning=${withStock.length}`);

    res.json({
      success: true,
      message: 'Products retrieved.',
      data: {
        products: withStock,
        pagination: paginate(total, parseInt(page), parseInt(limit)),
      },
    });
  } catch (err) {
    console.error('[Staff Products] error:', err.message);
    res.status(500).json({ success: false, message: err.message || 'Failed to load products.' });
  }
});

// ── Notifications (scoped to company user) ────────────────────
router.get   ('/notifications',              notificationCtrl.listNotifications);
router.patch ('/notifications/mark-all-read', notificationCtrl.markAllNotificationsRead);
router.patch ('/notifications/:id/read',     notificationCtrl.markNotificationRead);
router.delete('/notifications/:id',          notificationCtrl.deleteNotification);

module.exports = router;
