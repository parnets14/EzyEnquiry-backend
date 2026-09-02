const { sendSuccess, sendError } = require('../../utils/helpers');
const Sale      = require('../../models/Finance Management/Sale');
const Purchase  = require('../../models/Purchase & Inventory Management/Purchase');
const Expense   = require('../../models/Finance Management/Expense');
const Customer  = require('../../models/CRM Management/Customer');
const Inventory = require('../../models/Purchase & Inventory Management/Inventory');
const Employee  = require('../../models/HR Management/Employee');
const SalaryRecord = require('../../models/HR Management/SalaryRecord');
const Receivable   = require('../../models/Finance Management/Receivable');
const Payable      = require('../../models/Finance Management/Payable');
const mongoose  = require('mongoose');

/**
 * Shared time-grouping spec for reports.
 * group_by = day | week | month | year (default day).
 * Returns { _id, label, sort } for use in an aggregation pipeline.
 */
function timeGrouping(groupBy, field) {
  switch (groupBy) {
    case 'week':
      return {
        _id:   { year: { $isoWeekYear: field }, week: { $isoWeek: field } },
        label: { $concat: [{ $toString: '$_id.year' }, '-W', { $toString: '$_id.week' }] },
        sort:  { '_id.year': 1, '_id.week': 1 },
      };
    case 'month':
      return {
        _id:   { year: { $year: field }, month: { $month: field } },
        label: { $dateToString: { format: '%b %Y', date: { $dateFromParts: { year: '$_id.year', month: '$_id.month', day: 1 } } } },
        sort:  { '_id.year': 1, '_id.month': 1 },
      };
    case 'year':
      return {
        _id:   { year: { $year: field } },
        label: { $toString: '$_id.year' },
        sort:  { '_id.year': 1 },
      };
    case 'day':
    default:
      return {
        _id:   { year: { $year: field }, month: { $month: field }, day: { $dayOfMonth: field } },
        label: { $dateToString: { format: '%Y-%m-%d', date: { $dateFromParts: { year: '$_id.year', month: '$_id.month', day: '$_id.day' } } } },
        sort:  { '_id.year': 1, '_id.month': 1, '_id.day': 1 },
      };
  }
}

function resolveGroupBy(v) {
  return ['day', 'week', 'month', 'year'].includes(v) ? v : 'day';
}

/** GET /api/reports/sales */
async function getSalesReport(req, res) {
  const { from_date, to_date } = req.query;
  const group_by = resolveGroupBy(req.query.group_by);
  const cid      = new mongoose.Types.ObjectId(req.user.company_id.toString());
  const fromDate = new Date(from_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const toDate   = new Date(to_date   || new Date());
  const g        = timeGrouping(group_by, '$sale_date');

  const [rows, totalsAgg] = await Promise.all([
    Sale.aggregate([
      { $match: { company_id: cid, sale_date: { $gte: fromDate, $lte: toDate } } },
      { $group: {
        _id:         g._id,
        total_sales: { $sum: '$total_amount' },
        base_amount: { $sum: '$amount' },
        total_gst:   { $sum: '$gst_amount' },
        order_count: { $sum: 1 },
      }},
      { $sort: g.sort },
      { $project: {
        _id: 0,
        period:      g.label,
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
    group_by,
    period: { from: fromDate, to: toDate },
  });
}

/** GET /api/reports/purchases */
async function getPurchaseReport(req, res) {
  const { from_date, to_date } = req.query;
  const group_by = resolveGroupBy(req.query.group_by);
  const cid      = new mongoose.Types.ObjectId(req.user.company_id.toString());
  const fromDate = new Date(from_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const toDate   = new Date(to_date   || new Date());
  const g        = timeGrouping(group_by, '$purchase_date');

  const [rows, trend, totalsAgg] = await Promise.all([
    // Supplier-wise breakdown (existing behaviour)
    Purchase.aggregate([
      { $match: { company_id: cid, purchase_date: { $gte: fromDate, $lte: toDate } } },
      { $group: { _id: '$supplier_name', count: { $sum: 1 }, total: { $sum: '$total_amount' } } },
      { $project: { supplier_name: '$_id', count: 1, total: 1, _id: 0 } },
      { $sort: { total: -1 } },
    ]),
    // Time-based trend (day/week/month/year)
    Purchase.aggregate([
      { $match: { company_id: cid, purchase_date: { $gte: fromDate, $lte: toDate } } },
      { $group: { _id: g._id, total: { $sum: '$total_amount' }, count: { $sum: 1 } } },
      { $sort: g.sort },
      { $project: { _id: 0, period: g.label, total: 1, count: 1 } },
    ]),
    Purchase.aggregate([
      { $match: { company_id: cid, purchase_date: { $gte: fromDate, $lte: toDate } } },
      { $group: { _id: null, total: { $sum: '$total_amount' }, count: { $sum: 1 } } },
    ]),
  ]);

  sendSuccess(res, {
    rows,
    trend,
    totals: totalsAgg[0] || { total: 0, count: 0 },
    group_by,
    period: { from: fromDate, to: toDate },
  });
}

/** GET /api/reports/expenses */
async function getExpenseReport(req, res) {
  const { from_date, to_date } = req.query;
  const group_by = resolveGroupBy(req.query.group_by);
  const cid      = new mongoose.Types.ObjectId(req.user.company_id.toString());
  const fromDate = new Date(from_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const toDate   = new Date(to_date   || new Date());
  const g        = timeGrouping(group_by, '$expense_date');

  const [rows, trend, totalsAgg] = await Promise.all([
    // Category-wise breakdown (existing behaviour)
    Expense.aggregate([
      { $match: { company_id: cid, expense_date: { $gte: fromDate, $lte: toDate } } },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $project: { category: '$_id', total: 1, count: 1, _id: 0 } },
      { $sort: { total: -1 } },
    ]),
    // Time-based trend (day/week/month/year)
    Expense.aggregate([
      { $match: { company_id: cid, expense_date: { $gte: fromDate, $lte: toDate } } },
      { $group: { _id: g._id, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: g.sort },
      { $project: { _id: 0, period: g.label, total: 1, count: 1 } },
    ]),
    Expense.aggregate([
      { $match: { company_id: cid, expense_date: { $gte: fromDate, $lte: toDate } } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
  ]);

  sendSuccess(res, {
    rows,
    trend,
    totals: totalsAgg[0] || { total: 0, count: 0 },
    group_by,
    period: { from: fromDate, to: toDate },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT — PDF / Excel
// GET /api/reports/:type/export?format=pdf|excel&from_date=&to_date=&group_by=
//   type ∈ sales | purchases | expenses | inventory
// ─────────────────────────────────────────────────────────────────────────────
const { sendExcel, sendPdf } = require('../../utils/exporter');

const money = v => Number(v || 0).toLocaleString('en-IN');

async function exportReport(req, res) {
  const { type } = req.params;
  const format   = (req.query.format || 'excel').toLowerCase();
  const group_by = resolveGroupBy(req.query.group_by);
  const cid      = new mongoose.Types.ObjectId(req.user.company_id.toString());
  const fromDate = new Date(req.query.from_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const toDate   = new Date(req.query.to_date   || new Date());

  let title, columns, rows, totals = null;

  if (type === 'sales') {
    const g = timeGrouping(group_by, '$sale_date');
    const data = await Sale.aggregate([
      { $match: { company_id: cid, sale_date: { $gte: fromDate, $lte: toDate } } },
      { $group: { _id: g._id, total_sales: { $sum: '$total_amount' }, total_gst: { $sum: '$gst_amount' }, order_count: { $sum: 1 } } },
      { $sort: g.sort },
      { $project: { _id: 0, period: g.label, total_sales: 1, total_gst: 1, order_count: 1 } },
    ]);
    title   = `Sales Report (${group_by})`;
    columns = [
      { key: 'period', header: 'Period', width: 2 },
      { key: 'order_count', header: 'Orders', width: 1 },
      { key: 'total_gst', header: 'GST', width: 2 },
      { key: 'total_sales', header: 'Total Sales', width: 2 },
    ];
    rows   = data.map(r => ({ ...r, total_sales: money(r.total_sales), total_gst: money(r.total_gst) }));
    totals = { total_sales: money(data.reduce((s, r) => s + (r.total_sales || 0), 0)) };
  }

  else if (type === 'purchases') {
    const data = await Purchase.aggregate([
      { $match: { company_id: cid, purchase_date: { $gte: fromDate, $lte: toDate } } },
      { $group: { _id: '$supplier_name', count: { $sum: 1 }, total: { $sum: '$total_amount' } } },
      { $project: { supplier_name: '$_id', count: 1, total: 1, _id: 0 } },
      { $sort: { total: -1 } },
    ]);
    title   = 'Purchase Report (supplier-wise)';
    columns = [
      { key: 'supplier_name', header: 'Supplier', width: 3 },
      { key: 'count', header: 'Purchases', width: 1 },
      { key: 'total', header: 'Total', width: 2 },
    ];
    rows   = data.map(r => ({ ...r, total: money(r.total) }));
    totals = { total: money(data.reduce((s, r) => s + (r.total || 0), 0)) };
  }

  else if (type === 'expenses') {
    const data = await Expense.aggregate([
      { $match: { company_id: cid, expense_date: { $gte: fromDate, $lte: toDate } } },
      { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $project: { category: '$_id', total: 1, count: 1, _id: 0 } },
      { $sort: { total: -1 } },
    ]);
    title   = 'Expense Report (category-wise)';
    columns = [
      { key: 'category', header: 'Category', width: 3 },
      { key: 'count', header: 'Count', width: 1 },
      { key: 'total', header: 'Total', width: 2 },
    ];
    rows   = data.map(r => ({ ...r, total: money(r.total) }));
    totals = { total: money(data.reduce((s, r) => s + (r.total || 0), 0)) };
  }

  else if (type === 'inventory') {
    const data = await Inventory.find({ company_id: cid })
      .populate('product_id', 'name code')
      .sort({ current_stock: 1 })
      .limit(1000)
      .lean();
    title   = 'Inventory Report';
    columns = [
      { key: 'product_name', header: 'Product', width: 3 },
      { key: 'product_code', header: 'Code', width: 1 },
      { key: 'current_stock', header: 'Current Stock', width: 1 },
      { key: 'stock_in', header: 'Stock In', width: 1 },
      { key: 'stock_out', header: 'Stock Out', width: 1 },
    ];
    rows = data.map(r => ({
      product_name:  r.product_id?.name || r.product_name || '—',
      product_code:  r.product_id?.code || '—',
      current_stock: r.current_stock || 0,
      stock_in:      r.stock_in || 0,
      stock_out:     r.stock_out || 0,
    }));
  }

  else {
    return sendError(res, `Unknown report type "${type}". Use: sales, purchases, expenses, inventory.`, 400);
  }

  if (format === 'pdf')   return sendPdf(res,   { title, columns, rows, totals });
  if (format === 'excel' || format === 'xlsx') return sendExcel(res, { title, columns, rows, totals });
  return sendError(res, 'Invalid format. Use format=pdf or format=excel.', 400);
}

module.exports = { getSalesReport, getPurchaseReport, getExpenseReport, getCustomerReport, getSupplierReport, getInventoryReport, getEmployeeReport, exportReport };

/** GET /api/reports/customers */
async function getCustomerReport(req, res) {
  const { from_date, to_date } = req.query;
  const cid      = new mongoose.Types.ObjectId(req.user.company_id.toString());
  const fromDate = new Date(from_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const toDate   = new Date(to_date   || new Date());

  const [rows, totalsAgg] = await Promise.all([
    Sale.aggregate([
      { $match: { company_id: cid, sale_date: { $gte: fromDate, $lte: toDate } } },
      { $group: {
        _id:         '$customer_id',
        customer_name: { $first: '$customer_name' },
        order_count: { $sum: 1 },
        total_sales: { $sum: '$total_amount' },
        last_order:  { $max: '$sale_date' },
      }},
      { $sort: { total_sales: -1 } },
      { $limit: 100 },
      { $lookup: { from: 'receivables', localField: '_id', foreignField: 'customer_id', as: 'rcv' } },
      { $project: {
        customer_name: 1, order_count: 1, total_sales: 1, last_order: 1,
        outstanding: { $sum: '$rcv.outstanding' },
      }},
    ]),
    Sale.aggregate([
      { $match: { company_id: cid, sale_date: { $gte: fromDate, $lte: toDate } } },
      { $group: { _id: null, total: { $sum: '$total_amount' }, count: { $sum: 1 } } },
    ]),
  ]);

  sendSuccess(res, {
    rows,
    totals: totalsAgg[0] || { total: 0, count: 0 },
    period: { from: fromDate, to: toDate },
  });
}

/** GET /api/reports/suppliers */
async function getSupplierReport(req, res) {
  const { from_date, to_date } = req.query;
  const cid      = new mongoose.Types.ObjectId(req.user.company_id.toString());
  const fromDate = new Date(from_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const toDate   = new Date(to_date   || new Date());

  const [rows, totalsAgg] = await Promise.all([
    Purchase.aggregate([
      { $match: { company_id: cid, purchase_date: { $gte: fromDate, $lte: toDate } } },
      { $group: {
        _id:           '$supplier_id',
        supplier_name: { $first: '$supplier_name' },
        count:         { $sum: 1 },
        total:         { $sum: '$total_amount' },
        last_date:     { $max: '$purchase_date' },
      }},
      { $sort: { total: -1 } },
      { $lookup: { from: 'payables', localField: '_id', foreignField: 'supplier_id', as: 'pay' } },
      { $project: {
        supplier_name: 1, count: 1, total: 1, last_date: 1,
        outstanding: { $sum: '$pay.outstanding' },
      }},
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

/** GET /api/reports/inventory */
async function getInventoryReport(req, res) {
  const cid = new mongoose.Types.ObjectId(req.user.company_id.toString());

  const [rows, totalsAgg] = await Promise.all([
    Inventory.find({ company_id: cid })
      .populate('product_id', 'name code category_name brand_name unit')
      .sort({ current_stock: 1 })
      .limit(500)
      .lean(),
    Inventory.aggregate([
      { $match: { company_id: cid } },
      { $group: { _id: null, total_stock: { $sum: '$current_stock' }, count: { $sum: 1 } } },
    ]),
  ]);

  const mapped = rows.map(r => ({
    product_name:     r.product_id?.name       || r.product_name || '—',
    product_code:     r.product_id?.code       || '—',
    category_name:    r.product_id?.category_name || '—',
    brand_name:       r.product_id?.brand_name  || '—',
    unit:             r.product_id?.unit        || 'Box',
    warehouse_name:   r.warehouse_name          || '—',
    current_stock:    r.current_stock           || 0,
    low_stock_alert:  r.low_stock_alert         || 0,
    stock_in:         r.stock_in                || 0,
    stock_out:        r.stock_out               || 0,
  }));

  sendSuccess(res, {
    rows: mapped,
    totals: totalsAgg[0] || { total_stock: 0, count: 0 },
  });
}

/** GET /api/reports/employees */
async function getEmployeeReport(req, res) {
  const { month, year } = req.query;
  const cid       = req.user.company_id;
  const curMonth  = parseInt(month)  || new Date().getMonth() + 1;
  const curYear   = parseInt(year)   || new Date().getFullYear();

  const [employees, salaries] = await Promise.all([
    Employee.find({ company_id: cid }).lean(),
    SalaryRecord.find({ company_id: cid, month: curMonth, year: curYear }).lean(),
  ]);

  const rows = employees.map(emp => {
    const sal = salaries.find(s => s.employee_id?.toString() === emp._id?.toString())
    return {
      emp_code:    emp.emp_code    || '—',
      name:        emp.name        || '—',
      department:  emp.department  || '—',
      designation: emp.designation || '—',
      salary:      emp.salary      || 0,
      gross_salary:    sal?.gross_salary    || 0,
      total_deductions:sal?.total_deductions|| 0,
      net_salary:      sal?.net_salary      || 0,
      present_days:    sal?.present_days    || 0,
      absent_days:     sal?.absent_days     || 0,
      status:          sal?.status          || 'Pending',
    }
  })

  const totals = {
    total:       employees.length,
    total_gross: rows.reduce((a, r) => a + r.gross_salary, 0),
    total_net:   rows.reduce((a, r) => a + r.net_salary, 0),
    paid_count:  rows.filter(r => r.status === 'Paid').length,
  }

  sendSuccess(res, { rows, totals, period: { month: curMonth, year: curYear } });
}
