const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Finance Management/invoiceController');

// ── Invoice CRUD ──────────────────────────────────────────────
router.get   ('/',              ctrl.listInvoices);        // GET    /api/invoices
router.get   ('/summary',       ctrl.getInvoiceSummary);   // GET    /api/invoices/summary
router.get   ('/pending-verification', ctrl.listPendingVerification); // GET /api/invoices/pending-verification
router.get   ('/:id',           ctrl.getInvoice);          // GET    /api/invoices/:id
router.post  ('/',              ctrl.createInvoice);       // POST   /api/invoices
router.put   ('/:id',           ctrl.updateInvoice);       // PUT    /api/invoices/:id
router.patch ('/:id/status',    ctrl.updateInvoiceStatus); // PATCH  /api/invoices/:id/status
router.post  ('/:id/payment',   ctrl.recordPayment);       // POST   /api/invoices/:id/payment
router.post  ('/:id/payment/:phId/send-otp', ctrl.sendVerificationOtp); // POST send OTP
router.post  ('/:id/payment/:phId/verify',   ctrl.verifyPayment);       // POST verify
router.delete('/:id',           ctrl.deleteInvoice);       // DELETE /api/invoices/:id

module.exports = router;
