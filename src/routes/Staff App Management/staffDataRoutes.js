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
const productCtrl      = require('../../controllers/Product Management/productController');
const notificationCtrl = require('../../controllers/System Management/notificationController');

// ── Sales Orders (read) ──────────────────────────────────────
router.get('/orders',     orderCtrl.listOrders);
router.get('/orders/:id', orderCtrl.getOrder);

// ── Dispatches (read) ────────────────────────────────────────
router.get('/dispatches',     dispatchCtrl.listDispatches);
router.get('/dispatches/:id', dispatchCtrl.getDispatch);

// ── Invoices (read + record payment) ─────────────────────────
router.get ('/invoices',             invoiceCtrl.listInvoices);
router.get ('/invoices/summary',     invoiceCtrl.getInvoiceSummary);
router.get ('/invoices/:id',         invoiceCtrl.getInvoice);
router.post('/invoices/:id/payment', invoiceCtrl.recordPayment);

// ── Customers (list + create) ─────────────────────────────────
router.get ('/customers',     customerCtrl.listCustomers);
router.get ('/customers/:id', customerCtrl.getCustomer);
router.post('/customers',     customerCtrl.createCustomer);

// ── Quotations (list + create) ────────────────────────────────
router.get ('/quotations',     quotationCtrl.listQuotations);
router.get ('/quotations/:id', quotationCtrl.getQuotation);
router.post('/quotations',     quotationCtrl.createQuotation);

// ── Products (catalog — read-only search) ─────────────────────
router.get('/products', productCtrl.listProducts);

// ── Notifications (scoped to company user) ────────────────────
router.get   ('/notifications',              notificationCtrl.listNotifications);
router.patch ('/notifications/mark-all-read', notificationCtrl.markAllNotificationsRead);
router.patch ('/notifications/:id/read',     notificationCtrl.markNotificationRead);
router.delete('/notifications/:id',          notificationCtrl.deleteNotification);

module.exports = router;
