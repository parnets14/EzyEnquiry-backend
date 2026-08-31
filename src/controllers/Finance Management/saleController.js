/**
 * saleController.js
 *
 * Sales are linked to Orders → Inventory flow.
 * A Sale is auto-created by dispatchController.markDelivered,
 * or can be manually created for walk-in / direct sales.
 *
 * grand_total  = total_amount - discount
 * cogs         = purchase_rate × qty  (used for Gross Profit in P&L)
 * outstanding  = grand_total - paid_amount
 */

const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const Sale      = require('../../models/Finance Management/Sale');
const Order     = require('../../models/Marketplace Management/Order');
const Inventory = require('../../models/Purchase & Inventory Management/Inventory');
const mongoose  = require('mongoose');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function nextSaleCode() {
  const last = await Sale.findOne({ sale_code: /^SAL-/ }).sort({ sale_code: -1 }).lean();
  const num  = last?.sale_code ? parseInt(last.sale_code.split('-')[1], 10) : 0;
  return `SAL-${String(num + 1).padStart(4, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sales
// ─────────────────────────────────────────────────────────────────────────────
async function listSales(req, res) {
  const {
    search, payment_status, sale_status,
    warehouse_id, customer_id,
    from_date, to_date,
    page = 1, limit = 20,
  } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = { company_id: req.user.company_id };

  if (search) {
    query.$or = [
      { customer_name:  { $regex: search, $options: 'i' } },
      { product_name:   { $regex: search, $options: 'i' } },
      { sale_code:      { $regex: search, $options: 'i' } },
      { invoice_number: { $regex: search, $options: 'i' } },
    ];
  }
  if (payment_status && payment_status !== 'All') query.payment_status = payment_status;
  if (sale_status    && sale_status    !== 'All') query.sale_status    = sale_status;
  if (warehouse_id)  query.warehouse_id = warehouse_id;
  if (customer_id)   query.customer_id  = customer_id;
  if (from_date)     query.sale_date = { ...query.sale_date, $gte: new Date(from_date) };
  if (to_date)       query.sale_date = { ...query.sale_date, $lte: new Date(to_date + 'T23:59:59') };

  const [total, sales, aggregated] = await Promise.all([
    Sale.countDocuments(query),
    Sale.find(query)
      .populate('order_id',    'order_code status')
      .populate('warehouse_id','name')
      .sort({ sale_date: -1 })
      .skip(offset)
      .limit(parseInt(limit))
      .lean(),
    Sale.aggregate([
      { $match: query },
      {
        $group: {
          _id:           null,
          total_revenue: { $sum: '$grand_total' },
          total_cogs:    { $sum: '$cogs' },
          paid_count:    { $sum: { $cond: [{ $eq: ['$payment_status', 'Paid'] }, 1, 0] } },
          pending_count: { $sum: { $cond: [{ $ne: ['$payment_status', 'Paid'] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const agg = aggregated[0] || { total_revenue: 0, total_cogs: 0, paid_count: 0, pending_count: 0 };

  sendSuccess(res, {
    sales,
    summary: {
      total_sales:   total,
      total_revenue: agg.total_revenue,
      gross_profit:  agg.total_revenue - agg.total_cogs,
      paid_count:    agg.paid_count,
      pending_count: agg.pending_count,
    },
    pagination: paginate(total, parseInt(page), parseInt(limit)),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sales/:id
// ─────────────────────────────────────────────────────────────────────────────
async function getSale(req, res) {
  const sale = await Sale.findOne({ _id: req.params.id, company_id: req.user.company_id })
    .populate('order_id',    'order_code status enquiry_code due_date notes')
    .populate('warehouse_id','name city state')
    .populate('customer_id', 'name mobile email gstin billing_address')
    .lean();

  if (!sale) return sendError(res, 'Sale not found.', 404);
  sendSuccess(res, sale);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sales  — manual / direct sale creation
// ─────────────────────────────────────────────────────────────────────────────
async function createSale(req, res) {
  const { customer_name, product_id, qty, rate } = req.body;
  if (!customer_name) return sendError(res, 'customer_name is required.');
  if (!qty || !rate)  return sendError(res, 'qty and rate are required.');

  // Prevent duplicate if order_id already has a sale
  if (req.body.order_id) {
    const existing = await Sale.findOne({ order_id: req.body.order_id }).select('_id sale_code').lean();
    if (existing) return sendSuccess(res, existing, 'Sale already exists for this order.', 200);
  }

  const gst_pct    = parseFloat(req.body.gst_percent || req.body.gst_rate || 18);
  const qtyF       = parseFloat(qty);
  const rateF      = parseFloat(rate);
  const amount     = qtyF * rateF;
  const gst_amount = Math.round(amount * gst_pct / 100);
  const total_amount = amount + gst_amount;
  const discount   = parseFloat(req.body.discount || 0);
  const grand_total = total_amount - discount;

  // COGS: use inventory purchase_rate if product_id provided
  let cogs = 0;
  if (product_id) {
    const invFilter = { company_id: req.user.company_id, product_id };
    if (req.body.warehouse_id) invFilter.warehouse_id = req.body.warehouse_id;
    const inv = await Inventory.findOne(invFilter).select('purchase_rate').lean();
    cogs = (inv?.purchase_rate || 0) * qtyF;
  }

  const sale = await Sale.create({
    ...req.body,
    sale_code:      await nextSaleCode(),
    company_id:     req.user.company_id,
    amount,
    gst_percent:    gst_pct,
    gst_amount,
    total_amount,
    discount,
    grand_total,
    cogs,
    outstanding:    grand_total - parseFloat(req.body.paid_amount || 0),
    payment_status: req.body.payment_status || 'Pending',
    sale_status:    req.body.sale_status    || 'Confirmed',
    sale_date:      req.body.sale_date      || new Date(),
    created_by:     req.user._id,
  });

  sendSuccess(res, sale, 'Sale created.', 201);
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/sales/:id/payment  — record a payment against a sale
// Body: { paid_amount, payment_mode, notes }
// ─────────────────────────────────────────────────────────────────────────────
async function recordPayment(req, res) {
  const sale = await Sale.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
  if (!sale) return sendError(res, 'Sale not found.', 404);

  const newPaid   = (sale.paid_amount || 0) + parseFloat(req.body.paid_amount || 0);
  const outstanding = Math.max(0, (sale.grand_total || sale.total_amount) - newPaid);
  const paymentStatus = outstanding <= 0 ? 'Paid'
    : newPaid > 0 ? 'Partial' : 'Pending';

  const updated = await Sale.findByIdAndUpdate(sale._id, {
    paid_amount:    newPaid,
    outstanding,
    payment_status: paymentStatus,
    payment_mode:   req.body.payment_mode || sale.payment_mode,
    notes:          req.body.notes        || sale.notes,
  }, { new: true }).lean();

  sendSuccess(res, updated, `Payment recorded. Status: ${paymentStatus}.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sales/report  — aggregated sales report
// ─────────────────────────────────────────────────────────────────────────────
async function salesReport(req, res) {
  const { from_date, to_date, warehouse_id } = req.query;
  const cid   = new mongoose.Types.ObjectId(req.user.company_id.toString());
  const match = { company_id: cid };

  if (from_date) match.sale_date = { ...match.sale_date, $gte: new Date(from_date) };
  if (to_date)   match.sale_date = { ...match.sale_date, $lte: new Date(to_date + 'T23:59:59') };
  if (warehouse_id) match.warehouse_id = new mongoose.Types.ObjectId(warehouse_id);

  const [totals, byStatus, trend] = await Promise.all([
    Sale.aggregate([
      { $match: match },
      {
        $group: {
          _id:           null,
          total_sales:   { $sum: 1 },
          total_revenue: { $sum: '$grand_total' },
          total_cogs:    { $sum: '$cogs' },
          total_discount:{ $sum: '$discount' },
          total_gst:     { $sum: '$gst_amount' },
          total_paid:    { $sum: '$paid_amount' },
          total_outstanding: { $sum: '$outstanding' },
        },
      },
    ]),

    Sale.aggregate([
      { $match: match },
      { $group: { _id: '$payment_status', count: { $sum: 1 }, amount: { $sum: '$grand_total' } } },
    ]),

    Sale.aggregate([
      { $match: { ...match, sale_date: { $exists: true, $ne: null } } },
      {
        $group: {
          _id:     { year: { $year: '$sale_date' }, month: { $month: '$sale_date' } },
          revenue: { $sum: '$grand_total' },
          count:   { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
      { $limit: 12 },
      {
        $project: {
          _id: 0,
          month: {
            $dateToString: {
              format: '%b %Y',
              date:   { $dateFromParts: { year: '$_id.year', month: '$_id.month', day: 1 } },
            },
          },
          revenue: 1,
          count:   1,
        },
      },
    ]),
  ]);

  const t = totals[0] || {};
  sendSuccess(res, {
    total_sales:       t.total_sales       || 0,
    total_revenue:     t.total_revenue     || 0,
    total_cogs:        t.total_cogs        || 0,
    gross_profit:      (t.total_revenue || 0) - (t.total_cogs || 0),
    total_discount:    t.total_discount    || 0,
    total_gst:         t.total_gst         || 0,
    total_paid:        t.total_paid        || 0,
    total_outstanding: t.total_outstanding || 0,
    by_payment_status: byStatus,
    trend,
  });
}

module.exports = { listSales, getSale, createSale, recordPayment, salesReport };
