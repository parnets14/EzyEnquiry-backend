const { sendSuccess, sendError } = require('../../utils/helpers');
const Sale        = require('../../models/Finance Management/Sale');
const Expense     = require('../../models/Finance Management/Expense');
const Transaction = require('../../models/Finance Management/Transaction');
const Customer    = require('../../models/CRM Management/Customer');
const Supplier    = require('../../models/Purchase & Inventory Management/Supplier');
const Purchase    = require('../../models/Purchase & Inventory Management/Purchase');
const mongoose    = require('mongoose');

/** GET /api/accounts/ledger/customer */
async function getCustomerLedger(req, res) {
  const { customer_id } = req.query;
  if (!customer_id) return sendError(res, 'customer_id is required.');

  const customer = await Customer.findOne({ _id: customer_id, company_id: req.user.company_id }).lean();
  if (!customer) return sendError(res, 'Customer not found.', 404);

  const cid     = new mongoose.Types.ObjectId(req.user.company_id.toString());
  const cust_id = new mongoose.Types.ObjectId(customer_id);

  const [saleRows, paymentRows] = await Promise.all([
    Sale.find({ company_id: cid, customer_id: cust_id })
      .select('sale_code sale_date product_name qty rate total_amount')
      .sort({ sale_date: 1 }).lean(),
    Transaction.find({ company_id: cid, party_name: customer.name, type: 'Received' })
      .select('txn_code txn_date amount')
      .sort({ txn_date: 1 }).lean(),
  ]);

  const ledger = [
    ...saleRows.map(r    => ({ ...r, date: r.sale_date, type: 'Sale',    debit: r.total_amount, credit: 0 })),
    ...paymentRows.map(r => ({ ...r, date: r.txn_date,  type: 'Payment', debit: 0, credit: r.amount })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  let running = 0;
  const ledgerWithBalance = ledger.map(row => {
    running += parseFloat(row.debit) - parseFloat(row.credit);
    return { ...row, balance: running };
  });

  sendSuccess(res, { customer, ledger: ledgerWithBalance, closingBalance: running });
}

/** GET /api/accounts/ledger/supplier */
async function getSupplierLedger(req, res) {
  const { supplier_id } = req.query;
  if (!supplier_id) return sendError(res, 'supplier_id is required.');

  const supplier = await Supplier.findOne({ _id: supplier_id, company_id: req.user.company_id }).lean();
  if (!supplier) return sendError(res, 'Supplier not found.', 404);

  const cid   = new mongoose.Types.ObjectId(req.user.company_id.toString());
  const s_id  = new mongoose.Types.ObjectId(supplier_id);

  const [purchaseRows, paymentRows] = await Promise.all([
    Purchase.find({ company_id: cid, supplier_id: s_id })
      .select('purchase_code purchase_date product_name qty rate total_amount')
      .sort({ purchase_date: 1 }).lean(),
    Transaction.find({ company_id: cid, party_name: supplier.name, type: 'Paid' })
      .select('txn_code txn_date amount')
      .sort({ txn_date: 1 }).lean(),
  ]);

  const ledger = [
    ...purchaseRows.map(r => ({ ...r, date: r.purchase_date, type: 'Purchase', debit: 0,        credit: r.total_amount })),
    ...paymentRows.map(r  => ({ ...r, date: r.txn_date,      type: 'Payment',  debit: r.amount, credit: 0 })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  let running = 0;
  const ledgerWithBalance = ledger.map(row => {
    running += parseFloat(row.credit) - parseFloat(row.debit);
    return { ...row, balance: running };
  });

  sendSuccess(res, { supplier, ledger: ledgerWithBalance, closingBalance: running });
}

/** GET /api/accounts/cash-book
 *  Daily cash flow — all Cash-mode income and expense transactions
 */
async function getCashBook(req, res) {
  const cid      = new mongoose.Types.ObjectId(req.user.company_id.toString());
  const fromDate = req.query.from_date ? new Date(req.query.from_date) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const toDate   = req.query.to_date   ? new Date(req.query.to_date)   : new Date();
  toDate.setHours(23, 59, 59, 999);

  const [cashIn, cashOut, expenses] = await Promise.all([
    // Cash received from customers
    Transaction.find({ company_id: cid, type: 'Received', mode: 'Cash', txn_date: { $gte: fromDate, $lte: toDate } })
      .select('txn_code txn_date amount party_name notes')
      .sort({ txn_date: 1 }).lean(),
    // Cash paid to suppliers
    Transaction.find({ company_id: cid, type: 'Paid', mode: 'Cash', txn_date: { $gte: fromDate, $lte: toDate } })
      .select('txn_code txn_date amount party_name notes')
      .sort({ txn_date: 1 }).lean(),
    // Cash expenses
    Expense.find({ company_id: cid, payment_mode: 'Cash', expense_date: { $gte: fromDate, $lte: toDate } })
      .select('category amount description expense_date')
      .sort({ expense_date: 1 }).lean(),
  ]);

  const entries = [
    ...cashIn.map(r    => ({ date: r.txn_date,     type: 'Receipt',  description: `Received from ${r.party_name}`, debit: r.amount, credit: 0 })),
    ...cashOut.map(r   => ({ date: r.txn_date,     type: 'Payment',  description: `Paid to ${r.party_name}`,       debit: 0, credit: r.amount })),
    ...expenses.map(r  => ({ date: r.expense_date, type: 'Expense',  description: `${r.category}: ${r.description}`, debit: 0, credit: r.amount })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  let balance = 0;
  const withBalance = entries.map(row => {
    balance += parseFloat(row.debit) - parseFloat(row.credit);
    return { ...row, balance };
  });

  const totalIn  = cashIn.reduce((s, r)   => s + r.amount, 0);
  const totalOut = cashOut.reduce((s, r)  => s + r.amount, 0) + expenses.reduce((s, r) => s + r.amount, 0);

  sendSuccess(res, { period: { from: fromDate, to: toDate }, entries: withBalance, totalIn, totalOut, closingBalance: balance });
}

/** GET /api/accounts/bank-book
 *  Bank transactions — non-cash receipts and payments
 */
async function getBankBook(req, res) {
  const cid      = new mongoose.Types.ObjectId(req.user.company_id.toString());
  const fromDate = req.query.from_date ? new Date(req.query.from_date) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const toDate   = req.query.to_date   ? new Date(req.query.to_date)   : new Date();
  toDate.setHours(23, 59, 59, 999);

  const BANK_MODES = { $in: ['Bank Transfer', 'UPI', 'Cheque', 'NEFT', 'RTGS', 'IMPS'] };

  const [bankIn, bankOut] = await Promise.all([
    Transaction.find({ company_id: cid, type: 'Received', mode: BANK_MODES, txn_date: { $gte: fromDate, $lte: toDate } })
      .select('txn_code txn_date amount mode party_name reference notes')
      .sort({ txn_date: 1 }).lean(),
    Transaction.find({ company_id: cid, type: 'Paid', mode: BANK_MODES, txn_date: { $gte: fromDate, $lte: toDate } })
      .select('txn_code txn_date amount mode party_name reference notes')
      .sort({ txn_date: 1 }).lean(),
  ]);

  const entries = [
    ...bankIn.map(r  => ({ date: r.txn_date, type: 'Credit', mode: r.mode, description: `Received from ${r.party_name}`, ref: r.reference, debit: r.amount,  credit: 0 })),
    ...bankOut.map(r => ({ date: r.txn_date, type: 'Debit',  mode: r.mode, description: `Paid to ${r.party_name}`,       ref: r.reference, debit: 0, credit: r.amount })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  let balance = 0;
  const withBalance = entries.map(row => {
    balance += parseFloat(row.debit) - parseFloat(row.credit);
    return { ...row, balance };
  });

  const totalIn  = bankIn.reduce((s, r)  => s + r.amount, 0);
  const totalOut = bankOut.reduce((s, r) => s + r.amount, 0);

  sendSuccess(res, { period: { from: fromDate, to: toDate }, entries: withBalance, totalIn, totalOut, closingBalance: balance });
}

module.exports = { getCustomerLedger, getSupplierLedger, getCashBook, getBankBook };
