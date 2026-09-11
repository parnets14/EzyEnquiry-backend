const { sendSuccess, sendError } = require('../../utils/helpers');
const Sale        = require('../../models/Finance Management/Sale');
const Expense     = require('../../models/Finance Management/Expense');
const Transaction = require('../../models/Finance Management/Transaction');
const Customer    = require('../../models/CRM Management/Customer');
const Supplier    = require('../../models/Purchase & Inventory Management/Supplier');
const Purchase    = require('../../models/Purchase & Inventory Management/Purchase');
const Receivable  = require('../../models/Finance Management/Receivable');
const Payable     = require('../../models/Finance Management/Payable');
const Invoice     = require('../../models/Finance Management/Invoice');
const mongoose    = require('mongoose');

// Build a company scope filter. A Super Admin (no company_id) sees ALL companies
// (empty filter); everyone else is scoped to their own company. Returns an
// object suitable to spread into a Mongo query.
function companyScope(req) {
  const cid = req.user?.company_id;
  return cid ? { company_id: new mongoose.Types.ObjectId(cid.toString()) } : {};
}

/** GET /api/accounts/ledger/customer */
async function getCustomerLedger(req, res) {
  const { customer_id } = req.query;
  if (!customer_id) return sendError(res, 'customer_id is required.');

  const custScope = req.user?.company_id ? { company_id: req.user.company_id } : {};
  const customer = await Customer.findOne({ _id: customer_id, ...custScope }).lean();
  if (!customer) return sendError(res, 'Customer not found.', 404);

  // Scope sales/transactions to the customer's own company (works for Super Admin too).
  const cid     = new mongoose.Types.ObjectId(customer.company_id.toString());
  const cust_id = new mongoose.Types.ObjectId(customer_id);

  // Match by customer_id when records carry it, else fall back to the name
  // (case-insensitive, trimmed — a lot of records store only customer_name).
  const nameRx = new RegExp(`^\\s*${String(customer.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
  const idOrName = (extra = {}) => ({
    company_id: cid, ...extra,
    $or: [{ customer_id: cust_id }, { customer_name: nameRx }],
  });
  const receivedMatch = {
    company_id: cid, type: 'Received',
    $or: [{ customer_id: cust_id }, { party_name: nameRx }],
  };

  const [invoiceRows, saleRows, receivableRows, txnRows] = await Promise.all([
    // Invoices raised for this customer + their payment history.
    Invoice.find(idOrName())
      .select('invoice_no invoice_date grand_total payment_history')
      .sort({ invoice_date: 1 }).lean(),
    Sale.find(idOrName())
      .select('sale_code sale_date total_amount')
      .sort({ sale_date: 1 }).lean(),
    Receivable.find(idOrName())
      .select('rcv_code invoice_amount created_at due_date')
      .sort({ created_at: 1 }).lean(),
    // Standalone payment transactions (e.g. collected via Payment Management).
    Transaction.find(receivedMatch)
      .select('txn_code txn_date amount reference_id')
      .sort({ txn_date: 1 }).lean(),
  ]);

  const rows = [];

  if (invoiceRows.length) {
    // Preferred, real-world source: invoices (debit) + each payment (credit).
    const seenTxnRef = new Set();
    invoiceRows.forEach(inv => {
      rows.push({
        ref: inv.invoice_no, date: inv.invoice_date,
        type: 'Invoice', debit: Number(inv.grand_total) || 0, credit: 0,
      });
      (inv.payment_history || []).forEach(ph => {
        rows.push({
          ref: `${inv.invoice_no} · ${ph.payment_mode || 'Cash'}`, date: ph.payment_date,
          type: 'Payment', debit: 0, credit: Number(ph.amount) || 0,
        });
        if (ph._id) seenTxnRef.add(String(ph._id));
      });
    });
    // Add any standalone transactions that aren't already an invoice payment.
    txnRows.forEach(t => {
      if (t.reference_id && seenTxnRef.has(String(t.reference_id))) return;
      rows.push({ ref: t.txn_code, date: t.txn_date, type: 'Payment', debit: 0, credit: Number(t.amount) || 0 });
    });
  } else {
    // Fallback for older data: receivables/sales as debit, transactions as credit.
    const debitSrc = receivableRows.length
      ? receivableRows.map(r => ({ ref: r.rcv_code, date: r.created_at || r.due_date, type: 'Invoice', debit: Number(r.invoice_amount) || 0, credit: 0 }))
      : saleRows.map(r => ({ ref: r.sale_code, date: r.sale_date, type: 'Sale', debit: Number(r.total_amount) || 0, credit: 0 }));
    rows.push(...debitSrc);
    txnRows.forEach(t => rows.push({ ref: t.txn_code, date: t.txn_date, type: 'Payment', debit: 0, credit: Number(t.amount) || 0 }));
  }

  const ledger = rows.sort((a, b) => new Date(a.date) - new Date(b.date));

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

  const suppScope = req.user?.company_id ? { company_id: req.user.company_id } : {};
  const supplier = await Supplier.findOne({ _id: supplier_id, ...suppScope }).lean();
  if (!supplier) return sendError(res, 'Supplier not found.', 404);

  const cid   = new mongoose.Types.ObjectId(supplier.company_id.toString());
  const s_id  = new mongoose.Types.ObjectId(supplier_id);

  const suppNameRx = new RegExp(`^\\s*${String(supplier.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
  const idOrName = (extra = {}) => ({
    company_id: cid, ...extra,
    $or: [{ supplier_id: s_id }, { supplier_name: suppNameRx }],
  });
  const paidMatch = {
    company_id: cid, type: 'Paid',
    $or: [{ supplier_id: s_id }, { party_name: suppNameRx }],
  };

  const [purchaseRows, payableRows, paymentRows] = await Promise.all([
    Purchase.find(idOrName())
      .select('purchase_code purchase_date product_name qty rate total_amount')
      .sort({ purchase_date: 1 }).lean(),
    Payable.find(idOrName())
      .select('pay_code invoice_amount paid outstanding created_at due_date')
      .sort({ created_at: 1 }).lean().catch(() => []),
    Transaction.find(paidMatch)
      .select('txn_code txn_date amount')
      .sort({ txn_date: 1 }).lean(),
  ]);

  // Bills owed (credit side): prefer Payables, else fall back to Purchases.
  const creditRows = (payableRows && payableRows.length)
    ? payableRows.map(r => ({
        pay_code: r.pay_code, date: r.created_at || r.due_date,
        type: 'Bill', debit: 0, credit: r.invoice_amount || 0,
      }))
    : purchaseRows.map(r => ({
        purchase_code: r.purchase_code, date: r.purchase_date,
        type: 'Purchase', debit: 0, credit: r.total_amount || 0,
      }))

  const ledger = [
    ...creditRows,
    ...paymentRows.map(r => ({ txn_code: r.txn_code, date: r.txn_date, type: 'Payment', debit: Number(r.amount) || 0, credit: 0 })),
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
  const scope    = companyScope(req);
  const fromDate = req.query.from_date ? new Date(req.query.from_date) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const toDate   = req.query.to_date   ? new Date(req.query.to_date)   : new Date();
  toDate.setHours(23, 59, 59, 999);

  const [cashIn, cashOut, expenses] = await Promise.all([
    // Cash received from customers
    Transaction.find({ ...scope, type: 'Received', mode: 'Cash', txn_date: { $gte: fromDate, $lte: toDate } })
      .select('txn_code txn_date amount party_name notes')
      .sort({ txn_date: 1 }).lean(),
    // Cash paid to suppliers
    Transaction.find({ ...scope, type: 'Paid', mode: 'Cash', txn_date: { $gte: fromDate, $lte: toDate } })
      .select('txn_code txn_date amount party_name notes')
      .sort({ txn_date: 1 }).lean(),
    // Cash expenses
    Expense.find({ ...scope, payment_mode: 'Cash', expense_date: { $gte: fromDate, $lte: toDate } })
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
  const scope    = companyScope(req);
  const fromDate = req.query.from_date ? new Date(req.query.from_date) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const toDate   = req.query.to_date   ? new Date(req.query.to_date)   : new Date();
  toDate.setHours(23, 59, 59, 999);

  const BANK_MODES = { $in: ['Bank Transfer', 'UPI', 'Cheque', 'NEFT', 'RTGS', 'IMPS'] };

  const [bankIn, bankOut] = await Promise.all([
    Transaction.find({ ...scope, type: 'Received', mode: BANK_MODES, txn_date: { $gte: fromDate, $lte: toDate } })
      .select('txn_code txn_date amount mode party_name reference notes')
      .sort({ txn_date: 1 }).lean(),
    Transaction.find({ ...scope, type: 'Paid', mode: BANK_MODES, txn_date: { $gte: fromDate, $lte: toDate } })
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

/** GET /api/accounts/ledger/company
 *  Consolidated company ledger — every sale, purchase, receipt and payment in
 *  one running-balance book. Date-filterable via ?from_date=&to_date=.
 *  Convention: money coming IN (sales, receipts) = Credit; money going OUT
 *  (purchases, payments, expenses) = Debit. Balance = Credit − Debit.
 */
async function getCompanyLedger(req, res) {
  const scope    = companyScope(req);
  const fromDate = req.query.from_date ? new Date(req.query.from_date) : new Date(new Date().getFullYear(), 0, 1);
  const toDate   = req.query.to_date   ? new Date(req.query.to_date)   : new Date();
  toDate.setHours(23, 59, 59, 999);

  const [sales, purchases, received, paid, expenses] = await Promise.all([
    // Sales — deduplicate by order_id: if multiple Sale records exist for the
    // same order (legacy duplicates), use only the most recent one per order.
    Sale.aggregate([
      { $match: { ...scope, sale_date: { $gte: fromDate, $lte: toDate } } },
      { $sort: { sale_date: -1 } },
      {
        $group: {
          _id:          { $ifNull: ['$order_id', '$_id'] }, // group by order; standalone sales use own _id
          sale_code:    { $first: '$sale_code' },
          sale_date:    { $first: '$sale_date' },
          customer_name:{ $first: '$customer_name' },
          product_name: { $first: '$product_name' },
          qty:          { $first: '$qty' },
          total_amount: { $first: '$total_amount' },
        },
      },
      { $sort: { sale_date: 1 } },
    ]),
    // Purchases from Purchase Management only — exclude auto-created marketplace
    // procurement records (those have notes starting with 'Auto-created from
    // accepted quotation' and use the sale rate, not the actual cost price).
    Purchase.find({
      ...scope,
      purchase_date: { $gte: fromDate, $lte: toDate },
      notes: { $not: /^Auto-created from accepted quotation/i },
    })
      .select('purchase_code purchase_date supplier_name product_name qty total_amount')
      .sort({ purchase_date: 1 }).lean(),
    Transaction.find({ ...scope, type: 'Received', txn_date: { $gte: fromDate, $lte: toDate } })
      .select('txn_code txn_date amount party_name mode notes')
      .sort({ txn_date: 1 }).lean(),
    Transaction.find({ ...scope, type: 'Paid', txn_date: { $gte: fromDate, $lte: toDate } })
      .select('txn_code txn_date amount party_name mode notes')
      .sort({ txn_date: 1 }).lean(),
    Expense.find({ ...scope, expense_date: { $gte: fromDate, $lte: toDate } })
      .select('category description amount expense_date')
      .sort({ expense_date: 1 }).lean(),
  ]);

  // Also pull invoice payments so they show even before verification creates
  // a Transaction record (keeping the ledger always up to date).
  const invoices = await Invoice.find({ ...scope, 'payment_history.0': { $exists: true } })
    .select('invoice_no customer_name payment_history')
    .lean();

  // Build a Set of payment_history _ids already covered by a Transaction so
  // we never double-count a payment.
  const txnRefs = new Set([...received, ...paid].map(t => String(t.reference_id)).filter(Boolean));

  const rows = [
    // ── Sales → Debit (In): money earned by the company ──────────────────
    ...sales.map(r => ({
      date: r.sale_date, type: 'Sales',
      ref: r.sale_code || '', party: r.customer_name || '—',
      narration: `Sold ${r.product_name || ''}${r.qty ? ` × ${r.qty}` : ''}`.trim(),
      debit: r.total_amount || 0, credit: 0,
    })),
    // ── Purchases → money OUT for the company ─────────────────────────────
    // In the Company Book: purchases = Credit (Cr.) — you spent it / liability.
    ...purchases.map(r => ({
      date: r.purchase_date, type: 'Purchase', ref: r.purchase_code || '', party: r.supplier_name || '—',
      narration: `Purchased ${r.product_name || ''}${r.qty ? ` × ${r.qty}` : ''}`.trim(),
      debit: 0, credit: r.total_amount || 0,
    })),
    // ── Cash/bank received from customers → money IN ──────────────────────
    ...received.map(r => ({
      date: r.txn_date, type: 'Receipt', ref: r.txn_code || '', party: r.party_name || '—',
      narration: r.notes || `Received via ${r.mode || 'Cash'}`,
      debit: r.amount || 0, credit: 0,
    })),
    // ── Payments made to suppliers → money OUT ────────────────────────────
    ...paid.map(r => ({
      date: r.txn_date, type: 'Payment', ref: r.txn_code || '', party: r.party_name || '—',
      narration: r.notes || `Paid via ${r.mode || 'Bank'}`,
      debit: 0, credit: r.amount || 0,
    })),
    // ── Expenses → money OUT ──────────────────────────────────────────────
    ...expenses.map(r => ({
      date: r.expense_date, type: 'Expense', ref: '', party: r.category || 'Expense',
      narration: r.description || r.category || 'Expense',
      debit: 0, credit: r.amount || 0,
    })),
    // ── Invoice payments (before Transaction is created via verify) ───────
    ...invoices.flatMap(inv =>
      (inv.payment_history || [])
        .filter(ph => !txnRefs.has(String(ph._id)))
        .map(ph => ({
          date: ph.payment_date, type: 'Receipt', ref: inv.invoice_no || '', party: inv.customer_name || '—',
          narration: `Payment against ${inv.invoice_no || 'invoice'} via ${ph.payment_mode || 'Cash'}`,
          debit: Number(ph.amount) || 0, credit: 0,
        }))
    ),
  ].sort((a, b) => new Date(a.date) - new Date(b.date));

  // Final dedup pass — remove rows that are identical in (date, type, party, debit,
  // credit) to catch any edge cases where two records represent the same transaction.
  const seenKeys = new Set();
  const dedupedRows = rows.filter(r => {
    const d = r.date ? new Date(r.date).toDateString() : '';
    const key = `${d}|${r.type}|${r.party}|${r.debit}|${r.credit}`;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  // Running balance: Debit (in) − Credit (out) = net position.
  let running = 0;
  const ledger = dedupedRows.map(row => {
    running += (parseFloat(row.debit) || 0) - (parseFloat(row.credit) || 0);
    return { ...row, balance: running };
  });

  const totalDebit  = dedupedRows.reduce((s, r) => s + (parseFloat(r.debit)  || 0), 0);
  const totalCredit = dedupedRows.reduce((s, r) => s + (parseFloat(r.credit) || 0), 0);

  sendSuccess(res, {
    period: { from: fromDate, to: toDate },
    ledger,
    totalCredit,
    totalDebit,
    closingBalance: running,
  });
}

module.exports = { getCustomerLedger, getSupplierLedger, getCompanyLedger, getCashBook, getBankBook };
