const mongoose = require('mongoose')
const { sendSuccess, sendError, paginate } = require('../utils/helpers')
const { Purchase, Sale, Expense, Payment, Inventory, Notification } = require('../models')

// ─────────────────────────────────────────────────────────────
// PURCHASES
// ─────────────────────────────────────────────────────────────

async function listPurchases(req, res) {
  const { search, supplier_id, status, page = 1, limit = 20 } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)
  const [total, purchases] = await Promise.all([
    Purchase.count(req.user.company_id, { search, supplier_id, status }),
    Purchase.findAll(req.user.company_id, { search, supplier_id, status, limit: parseInt(limit), offset }),
  ])
  sendSuccess(res, { purchases, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

async function getPurchase(req, res) {
  const purchase = await Purchase.findById(req.params.id, req.user.company_id)
  if (!purchase) return sendError(res, 'Purchase not found.', 404)
  sendSuccess(res, purchase)
}

async function createPurchase(req, res) {
  const { supplier_name, qty, rate } = req.body
  if (!supplier_name || !qty || !rate) return sendError(res, 'Supplier name, qty and rate are required.')

  const gst_percent  = parseFloat(req.body.gst_percent || 18)
  const amount       = parseFloat(qty) * parseFloat(rate)
  const gst_amount   = Math.round(amount * gst_percent / 100)
  const total_amount = amount + gst_amount

  const purchase = await Purchase.create({
    ...req.body,
    company_id: req.user.company_id,
    amount, gst_amount, total_amount, gst_percent,
    created_by: req.user._id,
  })

  // Auto Stock-In
  if (req.body.product_id) {
    await Inventory.upsertStockIn(
      req.user.company_id,
      req.body.product_id,
      req.body.warehouse_id || null,
      qty
    )
  }

  // Auto create Payable
  await Payment.createPayable({
    company_id:     req.user.company_id,
    supplier_id:    req.body.supplier_id || null,
    supplier_name,
    purchase_id:    purchase._id,
    invoice_amount: total_amount,
  })

  sendSuccess(res, purchase, 'Purchase created. Inventory & payable auto-updated.', 201)
}

async function updatePurchase(req, res) {
  const purchase = await Purchase.update(req.params.id, req.user.company_id, req.body)
  if (!purchase) return sendError(res, 'Purchase not found.', 404)
  sendSuccess(res, purchase, 'Purchase updated.')
}

async function deletePurchase(req, res) {
  const deleted = await Purchase.delete(req.params.id, req.user.company_id)
  if (!deleted) return sendError(res, 'Purchase not found.', 404)
  sendSuccess(res, null, 'Purchase deleted.')
}

// ─────────────────────────────────────────────────────────────
// SUPPLIERS
// ─────────────────────────────────────────────────────────────

async function listSuppliers(req, res) {
  const suppliers = await Purchase.findAllSuppliers(req.user.company_id)
  sendSuccess(res, suppliers)
}

async function createSupplier(req, res) {
  const { name } = req.body
  if (!name) return sendError(res, 'Supplier name is required.')
  const supplier = await Purchase.createSupplier(req.user.company_id, req.body)
  sendSuccess(res, supplier, 'Supplier created.', 201)
}

async function updateSupplier(req, res) {
  const supplier = await Purchase.updateSupplier(req.params.id, req.user.company_id, req.body)
  if (!supplier) return sendError(res, 'Supplier not found.', 404)
  sendSuccess(res, supplier, 'Supplier updated.')
}

async function deleteSupplier(req, res) {
  const deleted = await Purchase.deleteSupplier(req.params.id, req.user.company_id)
  if (!deleted) return sendError(res, 'Supplier not found.', 404)
  sendSuccess(res, null, 'Supplier deleted.')
}

// ─────────────────────────────────────────────────────────────
// SALES
// ─────────────────────────────────────────────────────────────

async function listSales(req, res) {
  const { search, payment_status, page = 1, limit = 20 } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)
  const [total, sales] = await Promise.all([
    Sale.count(req.user.company_id, { search, payment_status }),
    Sale.findAll(req.user.company_id, { search, payment_status, limit: parseInt(limit), offset }),
  ])
  sendSuccess(res, { sales, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

async function createSale(req, res) {
  const { customer_name, qty, rate } = req.body
  if (!customer_name || !qty || !rate) return sendError(res, 'Customer name, qty and rate are required.')

  const gst_percent  = parseFloat(req.body.gst_percent || 18)
  const amount       = parseFloat(qty) * parseFloat(rate)
  const gst_amount   = Math.round(amount * gst_percent / 100)
  const total_amount = amount + gst_amount

  const sale = await Sale.create({
    ...req.body,
    company_id: req.user.company_id,
    amount, gst_amount, total_amount,
  })
  sendSuccess(res, sale, 'Sale entry created.', 201)
}

// ─────────────────────────────────────────────────────────────
// EXPENSES
// ─────────────────────────────────────────────────────────────

async function listExpenses(req, res) {
  const { category, from_date, to_date, page = 1, limit = 20 } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)
  const [total, expenses, totalAmount] = await Promise.all([
    Expense.count(req.user.company_id, { category, from_date, to_date }),
    Expense.findAll(req.user.company_id, { category, from_date, to_date, limit: parseInt(limit), offset }),
    Expense.getTotal(req.user.company_id, { category, from_date, to_date }),
  ])
  sendSuccess(res, { expenses, totalAmount, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

async function createExpense(req, res) {
  const { category, amount } = req.body
  if (!category || !amount) return sendError(res, 'Category and amount are required.')
  const expense = await Expense.create(req.user.company_id, { ...req.body, added_by: req.user._id })
  sendSuccess(res, expense, 'Expense recorded.', 201)
}

async function updateExpense(req, res) {
  const expense = await Expense.update(req.params.id, req.user.company_id, req.body)
  if (!expense) return sendError(res, 'Expense not found.', 404)
  sendSuccess(res, expense, 'Expense updated.')
}

async function deleteExpense(req, res) {
  const deleted = await Expense.delete(req.params.id, req.user.company_id)
  if (!deleted) return sendError(res, 'Expense not found.', 404)
  sendSuccess(res, null, 'Expense deleted.')
}

// ─────────────────────────────────────────────────────────────
// PAYMENTS
// ─────────────────────────────────────────────────────────────

async function listReceivables(req, res) {
  const { status, page = 1, limit = 20 } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)
  const [total, receivables] = await Promise.all([
    Payment.countReceivables(req.user.company_id, { status }),
    Payment.findAllReceivables(req.user.company_id, { status, limit: parseInt(limit), offset }),
  ])
  sendSuccess(res, { receivables, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

async function listPayables(req, res) {
  const { status, page = 1, limit = 20 } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)
  const [total, payables] = await Promise.all([
    Payment.countPayables(req.user.company_id, { status }),
    Payment.findAllPayables(req.user.company_id, { status, limit: parseInt(limit), offset }),
  ])
  sendSuccess(res, { payables, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

async function listTransactions(req, res) {
  const { type, page = 1, limit = 30 } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)
  const [total, transactions] = await Promise.all([
    Payment.countTransactions(req.user.company_id, { type }),
    Payment.findAllTransactions(req.user.company_id, { type, limit: parseInt(limit), offset }),
  ])
  sendSuccess(res, { transactions, pagination: paginate(total, parseInt(page), parseInt(limit)) })
}

async function collectReceivable(req, res) {
  const { amount, mode = 'Cash', reference = '', notes = '' } = req.body
  if (!amount || parseFloat(amount) <= 0) return sendError(res, 'Amount must be positive.')

  const rcv = await Payment.findReceivableById(req.params.id, req.user.company_id)
  if (!rcv) return sendError(res, 'Receivable not found.', 404)

  const updated = await Payment.collectReceivable(req.params.id, amount)

  if (rcv.sale_id) await Sale.updatePaymentStatus(rcv.sale_id, updated.status)

  await Payment.createTransaction({
    company_id:   req.user.company_id,
    type:         'Received',
    party_name:   rcv.customer_name,
    reference_id: rcv._id,
    amount, mode, reference, notes,
    recorded_by:  req.user._id,
  })

  await Notification.create(req.user.company_id, {
    type:         'payment',
    title:        'Payment Received',
    message:      `₹${parseFloat(amount).toLocaleString('en-IN')} received from ${rcv.customer_name}`,
    reference_id: rcv._id,
  })

  sendSuccess(res, updated, `Payment of ₹${amount} recorded.`)
}

async function payPayable(req, res) {
  const { amount, mode = 'Bank Transfer', reference = '', notes = '' } = req.body
  if (!amount || parseFloat(amount) <= 0) return sendError(res, 'Amount must be positive.')

  const payable = await Payment.findPayableById(req.params.id, req.user.company_id)
  if (!payable) return sendError(res, 'Payable not found.', 404)

  const updated = await Payment.payPayable(req.params.id, amount)

  await Payment.createTransaction({
    company_id:   req.user.company_id,
    type:         'Paid',
    party_name:   payable.supplier_name,
    reference_id: payable._id,
    amount, mode, reference, notes,
    recorded_by:  req.user._id,
  })

  sendSuccess(res, updated, `Payment of ₹${amount} recorded to supplier.`)
}

// ─────────────────────────────────────────────────────────────
// PROFIT & LOSS
// ─────────────────────────────────────────────────────────────

async function getProfitLoss(req, res) {
  const cid      = req.user.company_id
  const fromDate = req.query.from_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
  const toDate   = req.query.to_date   || new Date().toISOString().split('T')[0]

  const { PurchaseModel } = require('../models/Purchase')
  const { SalaryRecordModel } = require('../models/Employee')

  const [salesData, purchaseAgg, expenseBreakdown, salaryAgg, trend] = await Promise.all([
    Sale.getTotals(cid, fromDate, toDate),
    PurchaseModel.aggregate([
      {
        $match: {
          company_id:    new mongoose.Types.ObjectId(cid),
          purchase_date: { $gte: new Date(fromDate), $lte: new Date(toDate) },
        },
      },
      { $group: { _id: null, total: { $sum: '$total_amount' } } },
    ]),
    Expense.getBreakdown(cid, fromDate, toDate),
    SalaryRecordModel.aggregate([
      {
        $match: {
          company_id:   new mongoose.Types.ObjectId(cid),
          status:       'Paid',
          payment_date: { $gte: new Date(fromDate), $lte: new Date(toDate) },
        },
      },
      { $group: { _id: null, total: { $sum: '$net_salary' } } },
    ]),
    Sale.getMonthlyTrend(cid),
  ])

  const totalSales    = parseFloat(salesData.total_sales   || 0)
  const totalPurchase = parseFloat(purchaseAgg[0]?.total   || 0)
  const totalExpenses = expenseBreakdown.reduce((s, r) => s + parseFloat(r.total || 0), 0)
  const totalSalary   = parseFloat(salaryAgg[0]?.total     || 0)
  const grossProfit   = totalSales - totalPurchase
  const netProfit     = grossProfit - totalExpenses - totalSalary

  sendSuccess(res, {
    period: { from: fromDate, to: toDate },
    totalSales, totalPurchase, totalExpenses, totalSalary,
    grossProfit, netProfit, expenseBreakdown, trend,
  })
}

// ─────────────────────────────────────────────────────────────
// LEDGERS
// ─────────────────────────────────────────────────────────────

async function getCustomerLedger(req, res) {
  const { customer_id } = req.query
  if (!customer_id) return sendError(res, 'customer_id is required.')

  const { Customer }   = require('../models')
  const { SaleModel }  = require('../models/Sale')
  const { TransactionModel } = require('../models/Payment')

  const customer = await Customer.findById(customer_id, req.user.company_id)
  if (!customer) return sendError(res, 'Customer not found.', 404)

  const cid = new mongoose.Types.ObjectId(req.user.company_id)
  const cust_id = new mongoose.Types.ObjectId(customer_id)

  const [saleRows, paymentRows] = await Promise.all([
    SaleModel.find({ company_id: cid, customer_id: cust_id })
      .select('sale_code sale_date product_name qty rate total_amount')
      .sort({ sale_date: 1 })
      .lean(),
    TransactionModel.find({ company_id: cid, party_name: customer.name, type: 'Received' })
      .select('txn_code txn_date amount')
      .sort({ txn_date: 1 })
      .lean(),
  ])

  const ledger = [
    ...saleRows.map(r => ({ ...r, date: r.sale_date, type: 'Sale', debit: r.total_amount, credit: 0 })),
    ...paymentRows.map(r => ({ ...r, date: r.txn_date, type: 'Payment', debit: 0, credit: r.amount })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date))

  let running = 0
  const ledgerWithBalance = ledger.map(row => {
    running += parseFloat(row.debit) - parseFloat(row.credit)
    return { ...row, balance: running }
  })

  sendSuccess(res, { customer, ledger: ledgerWithBalance, closingBalance: running })
}

async function getSupplierLedger(req, res) {
  const { supplier_id } = req.query
  if (!supplier_id) return sendError(res, 'supplier_id is required.')

  const { PurchaseModel }    = require('../models/Purchase')
  const { TransactionModel } = require('../models/Payment')

  const supplier = await Purchase.findSupplierById(supplier_id, req.user.company_id)
  if (!supplier) return sendError(res, 'Supplier not found.', 404)

  const cid  = new mongoose.Types.ObjectId(req.user.company_id)
  const s_id = new mongoose.Types.ObjectId(supplier_id)

  const [purchaseRows, paymentRows] = await Promise.all([
    PurchaseModel.find({ company_id: cid, supplier_id: s_id })
      .select('purchase_code purchase_date product_name qty rate total_amount')
      .sort({ purchase_date: 1 })
      .lean(),
    TransactionModel.find({ company_id: cid, party_name: supplier.name, type: 'Paid' })
      .select('txn_code txn_date amount')
      .sort({ txn_date: 1 })
      .lean(),
  ])

  const ledger = [
    ...purchaseRows.map(r => ({ ...r, date: r.purchase_date, type: 'Purchase', debit: 0, credit: r.total_amount })),
    ...paymentRows.map(r => ({ ...r, date: r.txn_date, type: 'Payment', debit: r.amount, credit: 0 })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date))

  let running = 0
  const ledgerWithBalance = ledger.map(row => {
    running += parseFloat(row.credit) - parseFloat(row.debit)
    return { ...row, balance: running }
  })

  sendSuccess(res, { supplier, ledger: ledgerWithBalance, closingBalance: running })
}

module.exports = {
  listPurchases, getPurchase, createPurchase, updatePurchase, deletePurchase,
  listSuppliers, createSupplier, updateSupplier, deleteSupplier,
  listSales, createSale,
  listExpenses, createExpense, updateExpense, deleteExpense,
  listReceivables, listPayables, listTransactions,
  collectReceivable, payPayable,
  getProfitLoss,
  getCustomerLedger, getSupplierLedger,
}
