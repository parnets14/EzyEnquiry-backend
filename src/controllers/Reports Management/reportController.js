const { sendSuccess, sendError } = require('../../utils/helpers');
const Sale     = require('../../models/Finance Management/Sale');
const Purchase = require('../../models/Purchase & Inventory Management/Purchase');
const Expense  = require('../../models/Finance Management/Expense');
const mongoose = require('mongoose');

/** GET /api/reports/sales */
async function getSalesReport(req, res) {
  const { from_date, to_date, group_by = 'day' } = req.query;
  const cid      = new mongoose.Types.ObjectId(req.user.company_id.toString());
  const fromDate = new Date(from_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const toDate   = new Date(to_date   || new Date());

  const groupId = group_by === 'month'
    ? { year: { $year: '$sale_date' }, month: { $month: '$sale_date' } }
    : { year: { $year: '$sale_date' }, month: { $month: '$sale_date' }, day: { $dayOfMonth: '$sale_date' } };

  const [rows, totalsAgg] = await Promise.all([
    Sale.aggregate([
      { $match: { company_id: cid, sale_date: { $gte: fromDate, $lte: toDate } } },
      { $group: {
        _id:         groupId,
        total_sales: { $sum: '$total_amount' },
        base_amount: { $sum: '$amount' },
        total_gst:   { $sum: '$gst_amount' },
        order_count: { $sum: 1 },
        period_date: { $min: '$sale_date' },
      }},
      { $sort: { period_date: 1 } },
      { $project: {
        period:      { $dateToString: { format: group_by === 'month' ? '%b %Y' : '%Y-%m-%d', date: '$period_date' } },
        total_sales: 1, base_amount: 1, total_gst: 1, order_count: 1,
      }},
    ]),
    Sale.aggregate([
      { $match: { company_id: cid, sale_date: { $gte: fromDate, $lte: toDate } } },
      { $group: { _id: null, total: { $sum: '$total_amount' }, total_gst: { $sum: '$gst_amount' }, count: { $sum: 1 } } },
    ]),
  ]);

  sendSuccess(res, {
    rows,
    totals: totalsAgg[0] || { total: 0, total_gst: 0, count: 0 },
    period: { from: fromDate, to: toDate },
  });
}

/** GET /api/reports/purchases */
async function getPurchaseReport(req, res) {
  const { from_date, to_date } = req.query;
  const cid      = new mongoose.Types.ObjectId(req.user.company_id.toString());
  const fromDate = new Date(from_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const toDate   = new Date(to_date   || new Date());

  const [rows, totalsAgg] = await Promise.all([
    Purchase.aggregate([
      { $match: { company_id: cid, purchase_date: { $gte: fromDate, $lte: toDate } } },
      { $group: { _id: '$supplier_name', count: { $sum: 1 }, total: { $sum: '$total_amount' } } },
      { $project: { supplier_name: '$_id', count: 1, total: 1, _id: 0 } },
      { $sort: { total: -1 } },
    ]),
    Purchase.aggregate([
      { $match: { company_id: cid, purchase_date: { $gte: fromDate, $lte: toDate } } },
      { $group: { _id: null, total: { $sum: '$total_amount' }, count: { $sum: 1 } } },
    ]),
  ]);

  sendSuccess(res, {
    rows,
    totals: totalsAgg[0] || { total: 0, count: 0 },
    period: { from: fromDate, to: toDate },
  });
}

/** GET /api/reports/expenses */
async function getExpenseReport(req, res) {
  const { from_date, to_date } = req.query;
  const cid      = new mongoose.Types.ObjectId(req.user.company_id.toString());
  const fromDate = new Date(from_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const toDate   = new Date(to_date   || new Date());

  const [rows, totalsAgg] = await Promise.all([
    Expense.aggregate([
      { $match: { company_id: cid, expense_date: { $gte: fromDate, $lte: toDate } } },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $project: { category: '$_id', total: 1, count: 1, _id: 0 } },
      { $sort: { total: -1 } },
    ]),
    Expense.aggregate([
      { $match: { company_id: cid, expense_date: { $gte: fromDate, $lte: toDate } } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
  ]);

  sendSuccess(res, {
    rows,
    totals: totalsAgg[0] || { total: 0, count: 0 },
    period: { from: fromDate, to: toDate },
  });
}

module.exports = { getSalesReport, getPurchaseReport, getExpenseReport };
