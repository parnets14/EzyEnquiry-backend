const { sendSuccess, sendError } = require('../../utils/helpers');
const Sale     = require('../../models/Finance Management/Sale');
const Expense  = require('../../models/Finance Management/Expense');
const Purchase = require('../../models/Purchase & Inventory Management/Purchase');
const mongoose = require('mongoose');

/** GET /api/profit-loss */
async function getProfitLoss(req, res) {
  const cid      = req.user.company_id;
  const fromDate = req.query.from_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const toDate   = req.query.to_date   || new Date().toISOString().split('T')[0];

  const cid_obj = new mongoose.Types.ObjectId(cid.toString());

  const [salesAgg, purchaseAgg, expenseBreakdown, trend] = await Promise.all([
    Sale.aggregate([
      { $match: { company_id: cid_obj, sale_date: { $gte: new Date(fromDate), $lte: new Date(toDate) } } },
      { $group: { _id: null, total_sales: { $sum: '$total_amount' }, base_amount: { $sum: '$amount' }, total_gst: { $sum: '$gst_amount' }, total_count: { $sum: 1 } } },
    ]),
    Purchase.aggregate([
      { $match: { company_id: cid_obj, purchase_date: { $gte: new Date(fromDate), $lte: new Date(toDate) } } },
      { $group: { _id: null, total: { $sum: '$total_amount' } } },
    ]),
    Expense.aggregate([
      { $match: { company_id: cid_obj, expense_date: { $gte: new Date(fromDate), $lte: new Date(toDate) } } },
      { $group: { _id: '$category', total: { $sum: '$amount' } } },
      { $project: { category: '$_id', total: 1, _id: 0 } },
      { $sort: { total: -1 } },
    ]),
    Sale.aggregate([
      { $match: { company_id: cid_obj, sale_date: { $exists: true, $ne: null } } },
      { $group: { _id: { year: { $year: '$sale_date' }, month: { $month: '$sale_date' } }, sales: { $sum: '$total_amount' }, order_count: { $sum: 1 } } },
      { $sort: { '_id.year': -1, '_id.month': -1 } },
      { $limit: 12 },
      { $project: { _id: 0, month: { $dateToString: { format: '%b %Y', date: { $dateFromParts: { year: '$_id.year', month: '$_id.month', day: 1 } } } }, sales: 1, order_count: 1 } },
    ]),
  ]);

  const totalSales    = parseFloat(salesAgg[0]?.total_sales || 0);
  const totalPurchase = parseFloat(purchaseAgg[0]?.total    || 0);
  const totalExpenses = expenseBreakdown.reduce((s, r) => s + parseFloat(r.total || 0), 0);
  const grossProfit   = totalSales - totalPurchase;
  const netProfit     = grossProfit - totalExpenses;

  sendSuccess(res, {
    period: { from: fromDate, to: toDate },
    totalSales, totalPurchase, totalExpenses,
    grossProfit, netProfit,
    expenseBreakdown,
    trend: trend.reverse(),
  });
}

module.exports = { getProfitLoss };
