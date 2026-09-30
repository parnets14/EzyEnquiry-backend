/**
 * retailerDashboardController.js
 *
 * GET /api/retailer/erp/dashboard
 *
 * One aggregated payload powering the retailer home screen at wholesaler parity.
 *
 * ── WHY A NEW ENDPOINT ───────────────────────────────────────────────────────
 * The wholesaler home screen fans out across FIVE calls
 * (`/reports/dashboard`, `/enquiries`, `/inventory/summary`, `/payments/payables`,
 * `/reports/profit-loss`). A retailer token can't reach any of them — they are all
 * in ERP_ROUTE_PREFIXES and behind `denyRetailerErpAccess`. The existing retailer
 * `/api/retailer/dashboard` only returns marketplace counts, no money at all.
 *
 * So this aggregates everything the wholesaler dashboard shows, from the same
 * company-scoped models, in a SINGLE round trip. Field names are deliberately
 * wholesaler-compatible (`todaySales`, `pendingOrders`, `lowStockCount`,
 * `monthSales`/`monthPurchase`/`monthExpense`/`monthProfit`) so the ported home
 * screen reads the same keys as `wholesalerapp/src/screens/dashboard/DashboardScreen.jsx`.
 *
 * ── SCOPING NOTES (these are the subtle bits) ────────────────────────────────
 * 1. ERP money models (Sale/Expense/Purchase/Inventory/Receivable/Payable) are
 *    scoped by `company_id` — the retailer's OWN books. Identical to wholesaler.
 *
 * 2. Marketplace models (Order/Enquiry) are scoped by `buyer_company_id` — the
 *    retailer as a BUYER. The old retailer dashboard scoped by company AND user,
 *    so staff saw only their own orders. The wholesaler dashboard counts
 *    company-wide, and a dashboard is a company-level summary, so company-wide is
 *    the intended parity behaviour.
 *
 * 3. `Invoice` has NO `buyer_company_id` (it belongs to the seller). To find the
 *    invoices addressed to this retailer we must go through its own order ids:
 *    `Invoice.find({ order_id: { $in: buyerOrderIds } })`. This mirrors
 *    `retailerMarketplaceController.dashboard` exactly.
 *
 * ── RETAILER SEMANTICS ───────────────────────────────────────────────────────
 * A retailer both sells and buys, so the money columns are directional:
 *   paymentDue     — Receivable outstanding  = customers owe the retailer
 *   payableDue     — Payable outstanding     = the retailer owes its suppliers
 *   marketplaceDue — unpaid marketplace invoice balances = owed to wholesalers
 * They are reported separately rather than summed, because collapsing them would
 * hide which side the money is on.
 */
const mongoose = require('mongoose')
const { sendSuccess, sendError } = require('../../utils/helpers')

const Sale        = require('../../models/Finance Management/Sale')
const Expense     = require('../../models/Finance Management/Expense')
const Purchase    = require('../../models/Purchase & Inventory Management/Purchase')
const Inventory   = require('../../models/Purchase & Inventory Management/Inventory')
const Receivable  = require('../../models/Finance Management/Receivable')
const Payable     = require('../../models/Finance Management/Payable')
const Invoice     = require('../../models/Finance Management/Invoice')
const Enquiry     = require('../../models/Marketplace Management/Enquiry')
const Order       = require('../../models/Marketplace Management/Order')
const Product     = require('../../models/Product Management/Product')
const Customer    = require('../../models/CRM Management/Customer')
const Notification = require('../../models/System Management/Notification')

// Statuses that count as "not finished" for an order.
const OPEN_ORDER_STATUSES = [
  'New', 'Accepted', 'Packing', 'Picked', 'Processing', 'Ready', 'Ready for Dispatch',
  'Partially Dispatched', 'Dispatched', 'In Transit', 'Out for Delivery',
  'Pending Approval', 'Approved', 'Picking Started', 'Picking Completed',
  'Sorting Started', 'Sorting Completed', 'Packing Started', 'Packing Completed',
  'Invoice Generated',
]

// Stock buckets — identical expressions to inventoryController.getInventorySummary
// so the retailer's low/out-of-stock counts mean the same thing as the wholesaler's.
const STOCK_EFFECTIVE = { $max: ['$available_stock', '$current_stock'] }
const LOW_STOCK_EXPR = {
  $expr: {
    $and: [
      { $gt: [STOCK_EFFECTIVE, 0] },
      { $gt: ['$low_stock_alert', 0] },
      { $lte: [STOCK_EFFECTIVE, '$low_stock_alert'] },
    ],
  },
}
const OUT_OF_STOCK_EXPR = { $expr: { $lte: [STOCK_EFFECTIVE, 0] } }

const sum = (agg, key = 'total') => (agg && agg[0] ? agg[0][key] || 0 : 0)

async function getErpDashboard(req, res) {
  try {
    const cid = new mongoose.Types.ObjectId(req.user.company_id.toString())

    const today = new Date(); today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)

    const orderScope   = { buyer_company_id: req.user.company_id }
    const enquiryScope = { buyer_company_id: req.user.company_id }

    // Invoices addressed to this retailer are only reachable through its orders.
    const buyerOrderIds = await Order.find(orderScope).select('_id').lean().then(l => l.map(o => o._id))

    const [
      todaySalesAgg, monthSalesAgg, monthPurchaseAgg, monthExpenseAgg,
      receivableAgg, payableAgg,
      lowStockCount, outOfStockCount,
      totalOrders, openOrders, todayOrders,
      deliveredOrders, totalEnquiries, newEnquiries,
      unread, totalProducts, totalCustomers,
      invoiceAgg,
      recentEnquiries, recentOrders, trend,
    ] = await Promise.all([
      Sale.aggregate([
        { $match: { company_id: cid, sale_date: { $gte: today, $lt: tomorrow } } },
        { $group: { _id: null, total: { $sum: '$total_amount' } } },
      ]),
      Sale.aggregate([
        { $match: { company_id: cid, sale_date: { $gte: monthStart } } },
        { $group: { _id: null, total: { $sum: '$total_amount' } } },
      ]),
      Purchase.aggregate([
        { $match: { company_id: cid, purchase_date: { $gte: monthStart } } },
        { $group: { _id: null, total: { $sum: '$total_amount' } } },
      ]),
      Expense.aggregate([
        { $match: { company_id: cid, expense_date: { $gte: monthStart } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Receivable.aggregate([
        { $match: { company_id: cid, status: { $ne: 'Received' } } },
        { $group: { _id: null, total: { $sum: '$outstanding' } } },
      ]),
      Payable.aggregate([
        { $match: { company_id: cid, status: { $ne: 'Paid' } } },
        { $group: { _id: null, total: { $sum: '$outstanding' } } },
      ]),

      Inventory.countDocuments({ company_id: cid, ...LOW_STOCK_EXPR }),
      Inventory.countDocuments({ company_id: cid, ...OUT_OF_STOCK_EXPR }),

      Order.countDocuments(orderScope),
      Order.countDocuments({ ...orderScope, status: { $in: OPEN_ORDER_STATUSES } }),
      Order.countDocuments({ ...orderScope, created_at: { $gte: today, $lt: tomorrow } }),
      Order.countDocuments({ ...orderScope, status: 'Delivered' }),
      Enquiry.countDocuments(enquiryScope),
      Enquiry.countDocuments({ ...enquiryScope, status: 'New' }),

      Notification.countDocuments({ company_id: req.user.company_id, user_id: req.user._id, is_read: false }),
      Product.countDocuments({ company_id: cid, is_active: { $ne: false } }),
      Customer.countDocuments({ company_id: cid }),

      // Unpaid marketplace invoices — money the retailer owes wholesalers.
      buyerOrderIds.length
        ? Invoice.aggregate([
            { $match: { order_id: { $in: buyerOrderIds } } },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                dueCount: { $sum: { $cond: [{ $gt: ['$balance_due', 0] }, 1, 0] } },
                due: { $sum: '$balance_due' },
              },
            },
          ]).catch(() => [])
        : [],

      Enquiry.find(enquiryScope)
        .select('enq_code retailer_name product_name qty unit status created_at')
        .sort({ created_at: -1 })
        .limit(5)
        .lean(),

      Order.find(orderScope)
        .select('order_code status total_amount created_at product_name product_id seller_company_id')
        .populate('seller_company_id', 'name')
        .sort({ created_at: -1 })
        .limit(5)
        .lean(),

      // 6-month sales trend, same projection as the wholesaler dashboard.
      Sale.aggregate([
        { $match: { company_id: cid, sale_date: { $exists: true, $ne: null } } },
        { $group: { _id: { year: { $year: '$sale_date' }, month: { $month: '$sale_date' } }, sales: { $sum: '$total_amount' } } },
        { $sort: { '_id.year': -1, '_id.month': -1 } },
        { $limit: 6 },
        {
          $project: {
            _id: 0,
            month: {
              $dateToString: {
                format: '%b %Y',
                date: { $dateFromParts: { year: '$_id.year', month: '$_id.month', day: 1 } },
              },
            },
            sales: 1,
          },
        },
      ]),
    ])

    const monthSales    = sum(monthSalesAgg)
    const monthPurchase = sum(monthPurchaseAgg)
    const monthExpense  = sum(monthExpenseAgg)
    const inv           = (invoiceAgg && invoiceAgg[0]) || { count: 0, dueCount: 0, due: 0 }

    return sendSuccess(res, {
      // ── KPI cards ──
      todaySales:     sum(todaySalesAgg),
      todayOrders,
      pendingOrders:  openOrders,
      totalOrders,
      paymentDue:     sum(receivableAgg),   // customers owe the retailer
      payableDue:     sum(payableAgg),      // the retailer owes suppliers
      marketplaceDue: inv.due || 0,         // the retailer owes wholesalers
      marketplaceUnpaidInvoices: inv.dueCount || 0,

      // ── `orders` sub-object — same shape the wholesaler screen reads ──
      orders: {
        total:       totalOrders,
        pending:     openOrders,
        todayTotal:  todayOrders,
        delivered:   deliveredOrders,
      },

      // ── This-month P&L (same keys as reportsService.plReport) ──
      monthSales,
      monthPurchase,
      monthExpense,
      monthProfit: monthSales - monthPurchase - monthExpense,

      // ── Stock ──
      lowStockCount,
      outOfStockCount,

      // ── Totals ──
      totalProducts,
      totalCustomers,
      totalEnquiries,
      newEnquiries,
      deliveredOrders,
      yearSales: monthSales,

      // ── Lists ──
      recentEnquiries,
      recentOrders,
      trend: trend.reverse(),

      // ── Legacy retailer shape, kept so nothing else on the screen breaks ──
      counts: {
        enquiries:            totalEnquiries,
        orders:               totalOrders,
        delivered:            deliveredOrders,
        in_progress:          openOrders,
        unread_notifications: unread,
        invoices:             inv.count || 0,
        pending_payments:     inv.dueCount || 0,
        pending_amount:       inv.due || 0,
      },
      company_status: req.company?.status || null,
    })
  } catch (err) {
    return sendError(res, err.message || 'Could not load dashboard.', 500)
  }
}

module.exports = { getErpDashboard }
