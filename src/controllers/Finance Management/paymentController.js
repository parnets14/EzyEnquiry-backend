const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const Receivable   = require('../../models/Finance Management/Receivable');
const Payable      = require('../../models/Finance Management/Payable');
const Transaction  = require('../../models/Finance Management/Transaction');
const Sale         = require('../../models/Finance Management/Sale');
const Notification = require('../../models/System Management/Notification');

// ── Helper: next code ─────────────────────────────────────────
async function nextCode(Model, field, prefix) {
  const last = await Model.findOne({ [field]: new RegExp(`^${prefix}-`) }).sort({ [field]: -1 }).lean();
  if (!last?.[field]) return `${prefix}-0001`;
  const num = parseInt(last[field].split('-')[1], 10);
  return `${prefix}-${String(num + 1).padStart(4, '0')}`;
}

/** GET /api/payments/receivables */
async function listReceivables(req, res) {
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const query = { company_id: req.user.company_id };
  if (status && status !== 'All') query.status = status;

  const [total, receivables] = await Promise.all([
    Receivable.countDocuments(query),
    Receivable.find(query).sort({ due_date: 1 }).skip(offset).limit(parseInt(limit)).lean(),
  ]);
  sendSuccess(res, { receivables, pagination: paginate(total, parseInt(page), parseInt(limit)) });
}

/** GET /api/payments/payables */
async function listPayables(req, res) {
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const query = { company_id: req.user.company_id };
  if (status && status !== 'All') query.status = status;

  const [total, payables] = await Promise.all([
    Payable.countDocuments(query),
    Payable.find(query).sort({ due_date: 1 }).skip(offset).limit(parseInt(limit)).lean(),
  ]);
  sendSuccess(res, { payables, pagination: paginate(total, parseInt(page), parseInt(limit)) });
}

/** GET /api/payments/transactions */
async function listTransactions(req, res) {
  const { type, page = 1, limit = 30 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const query = { company_id: req.user.company_id };
  if (type && type !== 'All') query.type = type;

  const [total, transactions] = await Promise.all([
    Transaction.countDocuments(query),
    Transaction.find(query).sort({ txn_date: -1 }).skip(offset).limit(parseInt(limit)).lean(),
  ]);
  sendSuccess(res, { transactions, pagination: paginate(total, parseInt(page), parseInt(limit)) });
}

/** PATCH /api/payments/receivables/:id/collect */
async function collectReceivable(req, res) {
  const { amount, mode = 'Cash', reference = '', notes = '' } = req.body;
  if (!amount || parseFloat(amount) <= 0) return sendError(res, 'Amount must be positive.');

  const rcv = await Receivable.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
  if (!rcv) return sendError(res, 'Receivable not found.', 404);

  const newReceived    = parseFloat(rcv.received) + parseFloat(amount);
  const newOutstanding = Math.max(0, parseFloat(rcv.invoice_amount) - newReceived);
  const newStatus      = newOutstanding <= 0 ? 'Received' : 'Partial';

  const updated = await Receivable.findByIdAndUpdate(
    rcv._id,
    { received: newReceived, outstanding: newOutstanding, status: newStatus },
    { new: true }
  ).lean();

  if (rcv.sale_id) await Sale.findByIdAndUpdate(rcv.sale_id, { payment_status: newStatus });

  const txn_code = await nextCode(Transaction, 'txn_code', 'TXN');
  await Transaction.create({
    txn_code,
    company_id:   req.user.company_id,
    type:         'Received',
    party_name:   rcv.customer_name,
    reference_id: rcv._id,
    amount, mode, reference, notes,
    recorded_by:  req.user._id,
    txn_date:     new Date(),
  });

  await Notification.create({
    company_id:   req.user.company_id,
    type:         'payment',
    title:        'Payment Received',
    message:      `₹${parseFloat(amount).toLocaleString('en-IN')} received from ${rcv.customer_name}`,
    reference_id: rcv._id,
  });

  sendSuccess(res, updated, `Payment of ₹${amount} recorded.`);
}

/** PATCH /api/payments/payables/:id/pay */
async function payPayable(req, res) {
  const { amount, mode = 'Bank Transfer', reference = '', notes = '' } = req.body;
  if (!amount || parseFloat(amount) <= 0) return sendError(res, 'Amount must be positive.');

  const payable = await Payable.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
  if (!payable) return sendError(res, 'Payable not found.', 404);

  const newPaid        = parseFloat(payable.paid) + parseFloat(amount);
  const newOutstanding = Math.max(0, parseFloat(payable.invoice_amount) - newPaid);
  const newStatus      = newOutstanding <= 0 ? 'Paid' : 'Partial';

  const updated = await Payable.findByIdAndUpdate(
    payable._id,
    { paid: newPaid, outstanding: newOutstanding, status: newStatus },
    { new: true }
  ).lean();

  const txn_code = await nextCode(Transaction, 'txn_code', 'TXN');
  await Transaction.create({
    txn_code,
    company_id:   req.user.company_id,
    type:         'Paid',
    party_name:   payable.supplier_name,
    reference_id: payable._id,
    amount, mode, reference, notes,
    recorded_by:  req.user._id,
    txn_date:     new Date(),
  });

  sendSuccess(res, updated, `Payment of ₹${amount} recorded to supplier.`);
}

module.exports = { listReceivables, listPayables, listTransactions, collectReceivable, payPayable };
