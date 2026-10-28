const express = require('express');
const ctrl = require('../controllers/Finance Management/quotationController');
const Quotation = require('../models/Finance Management/Quotation');
const { sendError } = require('../utils/helpers');
const { validateObjectIdParam } = require('../middleware/validateObjectId');

const router = express.Router();
router.param('id', validateObjectIdParam('id'));

router.get('/', (req, res, next) => {
  req.query.source = 'Showroom Enquiry';
  return ctrl.listQuotations(req, res, next);
});
router.post('/', (req, res, next) => {
  req.body.source = 'Showroom Enquiry';
  req.body.created_by_type = req.body.created_by_type || (req.isStaffApp ? 'Staff App' : 'Admin');
  return ctrl.createQuotation(req, res, next);
});
const APPROVER_ROLES = ['Super Admin', 'Company Owner', 'Accountant'];
async function loadShowroomQuotation(req, res, next) {
  const quotation = await Quotation.findOne({ _id: req.params.id, company_id: req.user.company_id, source: 'Showroom Enquiry' });
  if (!quotation) return sendError(res, 'Showroom enquiry not found.', 404);
  req.showroomQuotation = quotation;
  return next();
}
router.put('/:id', loadShowroomQuotation, (req, res, next) => {
  const q = req.showroomQuotation;
  if (q.status === 'accepted') {
    const linkFields = new Set(['invoice_id', 'invoice_no']);
    if (Object.keys(req.body || {}).some(field => !linkFields.has(field))) return sendError(res, 'Approved enquiry pricing and items are locked.', 409);
  }
  if (q.status === 'converted') return sendError(res, 'A bill-generated enquiry is locked.', 409);
  if (q.status !== 'draft' && !APPROVER_ROLES.includes(req.user.role)) return sendError(res, 'Only draft enquiries can be edited by sales staff.', 403);
  if (q.status === 'draft' && String(q.created_by || '') !== String(req.user._id) && !APPROVER_ROLES.includes(req.user.role)) return sendError(res, 'Only the enquiry owner can edit this draft.', 403);
  return ctrl.updateQuotation(req, res, next);
});
router.patch('/:id/status', loadShowroomQuotation, (req, res, next) => {
  const { status } = req.body;
  if (!['sent', 'accepted', 'converted'].includes(status)) return sendError(res, 'Invalid showroom enquiry status transition.', 400);
  if (['accepted', 'converted'].includes(status) && !APPROVER_ROLES.includes(req.user.role)) return sendError(res, 'Admin/Accounts approval is required.', 403);
  if (status === 'sent' && req.showroomQuotation.status !== 'draft') return sendError(res, 'Only a draft can be sent for approval.', 409);
  if (status === 'accepted' && req.showroomQuotation.status !== 'sent') return sendError(res, 'Only a sent enquiry can be approved.', 409);
  if (status === 'converted' && req.showroomQuotation.status !== 'accepted') return sendError(res, 'Approve the enquiry before generating its bill.', 409);
  if (status === 'sent' && String(req.showroomQuotation.created_by || '') !== String(req.user._id) && !APPROVER_ROLES.includes(req.user.role)) return sendError(res, 'Only the enquiry owner can send it for approval.', 403);
  return ctrl.updateQuotationStatus(req, res, next);
});

module.exports = router;
