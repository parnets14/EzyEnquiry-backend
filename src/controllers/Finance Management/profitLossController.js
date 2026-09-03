const { sendSuccess, sendError } = require('../../utils/helpers');
const Sale         = require('../../models/Finance Management/Sale');
const Expense      = require('../../models/Finance Management/Expense');
const Purchase     = require('../../models/Purchase & Inventory Management/Purchase');
const SalaryRecord = require('../../models/HR Management/SalaryRecord');
const mongoose     = require('mongoose');

/**
 * Build a { _id, label, sort } grouping spec for a trend aggregation
 * based on group_by = day | week | month | year (default month).
 * `field` is the date field on the collection (e.g. '$sale_date').
 */
function trendGrouping(groupBy, field) {
  switch (groupBy) {
    case 'day':
      return {
        _id:    { year: { $year: field }, month: { $month: field }, day: { $dayOfMonth: field } },
        label:  { $dateToString: { format: '%Y-%m-%d', date: { $dateFromParts: { year: '$_id.year', month: '$_id.month', day: '$_id.day' } } } },
        sort:   { '_id.year': -1, '_id.month': -1, '_id.day': -1 },
      };
    case 'week':
      return {
        _id:    { year: { $isoWeekYear: field }, week: { $isoWeek: field } },
        label:  { $concat: [{ $toString: '$_id.year' }, '-W', { $toString: '$_id.week' }] },
        sort:   { '_id.year': -1, '_id.week': -1 },
      };
    case 'year':
      return {
        _id:    { year: { $year: field } },
        label:  { $toString: '$_id.year' },
        sort:   { '_id.year': -1 },
      };
    case 'month':
    default:
      return {
        _id:    { year: { $year: field }, month: { $month: field } },
        label:  { $dateToString: { format: '%b %Y', date: { $dateFromParts: { year: '$_id.year', month: '$_id.month', day: 1 } } } },
        sort:   { '_id.year': -1, '_id.month': -1 },
      };
  }
}

/** GET /api/profit-loss
 *
 * Requirement §15 formula:
 *   Sales Revenue
 *   − Purchase Cost (COGS)
 *   = Gross Profit
 *   − Operating Expenses (all non-salary categories)
 *   − Salary / Payroll  (from SalaryRecord.net_salary)
 *   − Marketing Cost    (Expense category = Marketing + Google Ads)
 *   = Net Profit
 */
async function getProfitLoss(req, res) {
  const cid      = req.user.company_id;
  const fromDate = req.query.from_date
    || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const toDate   = req.query.to_date || new Date().toISOString().split('T')[0];

  const cid_obj  = new mongoose.Types.ObjectId(cid.toString());
  const dateFrom = new Date(fromDate);
  const dateTo   = new Date(toDate + 'T23:59:59');

  const groupBy   = ['day', 'week', 'month', 'year'].includes(req.query.group_by) ? req.query.group_by : 'month';
  const trendLimit = groupBy === 'day' ? 30 : groupBy === 'week' ? 12 : groupBy === 'year' ? 5 : 12;
  const gSale = trendGrouping(groupBy, '$sale_date');
  const gPur  = trendGrouping(groupBy, '$purchase_date');
  const gExp  = trendGrouping(groupBy, '$expense_date');

  // Parse month/year from fromDate for salary lookup
  const fromYear  = dateFrom.getFullYear();
  const fromMonth = dateFrom.getMonth() + 1;
  const toYear    = dateTo.getFullYear();
  const toMonth   = dateTo.getMonth() + 1;

  const [salesAgg, purchaseAgg, expenseBreakdown, salaryAgg, trend] = await Promise.all([
    // Sales
    Sale.aggregate([
      { $match: { company_id: cid_obj, sale_date: { $gte: dateFrom, $lte: dateTo } } },
      { $group: { _id: null, total_sales: { $sum: '$total_amount' }, base_amount: { $sum: '$amount' }, total_gst: { $sum: '$gst_amount' }, total_count: { $sum: 1 } } },
    ]),

    // Purchase (COGS)
    Purchase.aggregate([
      { $match: { company_id: cid_obj, purchase_date: { $gte: dateFrom, $lte: dateTo } } },
      { $group: { _id: null, total: { $sum: '$total_amount' } } },
    ]),

    // Expense breakdown by category — includes Marketing, Google Ads, Salary etc.
    Expense.aggregate([
      { $match: { company_id: cid_obj, expense_date: { $gte: dateFrom, $lte: dateTo } } },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $project: { category: '$_id', total: 1, count: 1, _id: 0 } },
      { $sort: { total: -1 } },
    ]),

    // Salary — sum net_salary for months in the date range
    SalaryRecord.aggregate([
      {
        $match: {
          company_id: cid_obj,
          status:     'Paid',
          $or: [
            { year: { $gt: fromYear }, },
            { year: fromYear, month: { $gte: fromMonth } },
          ],
          $and: [
            {
              $or: [
                { year: { $lt: toYear } },
                { year: toYear, month: { $lte: toMonth } },
              ],
            },
          ],
        },
      },
      { $group: { _id: null, total: { $sum: '$net_salary' } } },
    ]),

    // Sales trend — grouped by day/week/month/year
    Sale.aggregate([
      { $match: { company_id: cid_obj, sale_date: { $exists: true, $ne: null } } },
      { $group: { _id: gSale._id, sales: { $sum: '$total_amount' }, order_count: { $sum: 1 } } },
      { $sort: gSale.sort },
      { $limit: trendLimit },
      { $project: { _id: 0, month: gSale.label, sales: 1, order_count: 1 } },
    ]),
  ]);

  const totalSales    = parseFloat(salesAgg[0]?.total_sales || 0);
  const totalPurchase = parseFloat(purchaseAgg[0]?.total    || 0);
  const totalSalary   = parseFloat(salaryAgg[0]?.total      || 0);

  // Split expenses: marketing cost = Marketing + Google Ads; operating = rest
  const MARKETING_CATS = ['Marketing', 'Google Ads'];
  const totalExpenses  = expenseBreakdown.reduce((s, r) => s + parseFloat(r.total || 0), 0);
  const marketingCost  = expenseBreakdown
    .filter(r => MARKETING_CATS.includes(r.category))
    .reduce((s, r) => s + parseFloat(r.total || 0), 0);
  const operatingExpenses = totalExpenses - marketingCost;

  // P&L formula per requirement §15
  const grossProfit = totalSales - totalPurchase;
  const netProfit   = grossProfit - operatingExpenses - totalSalary - marketingCost;

  // Purchase trend — same grouping as sales
  const purchaseTrend = await Purchase.aggregate([
    { $match: { company_id: cid_obj, purchase_date: { $exists: true, $ne: null } } },
    { $group: { _id: gPur._id, purchase: { $sum: '$total_amount' } } },
    { $sort: gPur.sort },
    { $limit: trendLimit },
    { $project: { _id: 0, month: gPur.label, purchase: 1 } },
  ]);

  // Expense trend — same grouping as sales
  const expenseTrend = await Expense.aggregate([
    { $match: { company_id: cid_obj, expense_date: { $exists: true, $ne: null } } },
    { $group: { _id: gExp._id, expenses: { $sum: '$amount' } } },
    { $sort: gExp.sort },
    { $limit: trendLimit },
    { $project: { _id: 0, month: gExp.label, expenses: 1 } },
  ]);

  // Merge all trends by month label
  const mergedTrend = trend.reverse().map(t => {
    const pur = purchaseTrend.find(p => p.month === t.month) || {}
    const exp = expenseTrend.find(e => e.month === t.month)  || {}
    return {
      month:    t.month,
      sales:    t.sales    || 0,
      purchase: pur.purchase || 0,
      expenses: exp.expenses || 0,
      profit:   (t.sales || 0) - (pur.purchase || 0) - (exp.expenses || 0),
    }
  });

  sendSuccess(res, {
    period:         { from: fromDate, to: toDate },
    group_by:       groupBy,
    totalSales,
    totalPurchase,
    totalExpenses,
    operatingExpenses,
    marketingCost,
    totalSalary,
    grossProfit,
    netProfit,
    expenseBreakdown,
    trend: mergedTrend,
  });
}

module.exports = { getProfitLoss };
