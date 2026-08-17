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

module.exports = { getCustomerLedger, getSupplierLedger };
