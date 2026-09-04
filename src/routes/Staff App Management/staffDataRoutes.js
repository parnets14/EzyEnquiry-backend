/**
 * staffDataRoutes.js
 *
 * Read + light-write endpoints for the Staff mobile app, mounted at
 * /api/staff. These reuse the existing company-scoped controllers so a staff
 * member (a Sales Executive User whose company_id matches the seller) can see
 * the company's Sales Orders and Invoices, and record a payment against an
 * invoice — without needing the full CRM module permissions.
 *
 * Auth: the parent router already applies `authenticate` + `requireCompany`,
 * so every controller here is scoped by req.user.company_id.
 */
const express = require('express');
const router  = express.Router();

const orderCtrl   = require('../../controllers/Marketplace Management/orderController');
const invoiceCtrl = require('../../controllers/Finance Management/invoiceController');

// ── Sales Orders (read) ──────────────────────────────────────
router.get('/orders',              orderCtrl.listOrders);
router.get('/orders/:id',          orderCtrl.getOrder);

// ── Invoices (read + record payment) ─────────────────────────
router.get ('/invoices',            invoiceCtrl.listInvoices);
router.get ('/invoices/summary',    invoiceCtrl.getInvoiceSummary);
router.get ('/invoices/:id',        invoiceCtrl.getInvoice);
router.post('/invoices/:id/payment', invoiceCtrl.recordPayment);

module.exports = router;
