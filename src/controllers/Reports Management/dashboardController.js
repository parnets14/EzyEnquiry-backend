const { sendSuccess, sendError } = require('../../utils/helpers');
const Customer    = require('../../models/CRM Management/Customer');
const Product     = require('../../models/Product Management/Product');
const Enquiry     = require('../../models/Marketplace Management/Enquiry');
const Order       = require('../../models/Marketplace Management/Order');
const Dispatch    = require('../../models/Marketplace Management/Dispatch');
const Sale        = require('../../models/Finance Management/Sale');
const Inventory   = require('../../models/Purchase & Inventory Management/Inventory');
const Receivable  = require('../../models/Finance Management/Receivable');
const User        = require('../../models/User Management/User');
const mongoose    = require('mongoose');

/** GET /api/reports/dashboard */
async function getDashboardStats(req, res) {
  const cid = new mongoose.Types.ObjectId(req.user.company_id.toString());

  const today      = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow   = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const yearStart  = new Date(today.getFullYear(), 0, 1);

  // ── Build Retailer and Wholesaler user-id lists for this company ──
  const [retailerUsers, wholesalerUsers] = await Promise.all([
    User.find({ company_id: cid, role: 'Retailer'   }).select('_id').lean(),
    User.find({ company_id: cid, role: 'Wholesaler' }).select('_id').lean(),
  ]);
  const retailerIds    = retailerUsers.map(u => u._id);
  const wholesalerIds  = wholesalerUsers.map(u => u._id);

  const [
    totalCustomers, totalProducts, totalEnquiries, totalOrders,
    totalDispatches, pendingOrders, lowStockCount,
    totalOutstanding, todaySales, monthSales, yearSales,
    topProducts, topCustomers, recentEnquiries,
    topRetailersAgg, topWholesalersAgg,
    trend,
  ] = await Promise.all([
    Customer.countDocuments({ company_id: cid }),
    Product.countDocuments({ company_id: cid, is_active: true }),
    Enquiry.countDocuments({ company_id: cid }),
    Order.countDocuments({ company_id: cid }),
    Dispatch.countDocuments({ company_id: cid }),
    Order.countDocuments({ company_id: cid, status: { $in: ['New', 'Accepted', 'Processing', 'Ready'] } }),
    Inventory.countDocuments({ company_id: cid, $expr: { $lte: ['$current_stock', '$low_stock_alert'] } }),
    Receivable.aggregate([
      { $match: { company_id: cid, status: { $ne: 'Received' } } },
      { $group: { _id: null, total: { $sum: '$outstanding' } } },
    ]),
    Sale.aggregate([
      { $match: { company_id: cid, sale_date: { $gte: today, $lt: tomorrow } } },
      { $group: { _id: null, total: { $sum: '$total_amount' } } },
    ]),
    Sale.aggregate([
      { $match: { company_id: cid, sale_date: { $gte: monthStart } } },
      { $group: { _id: null, total: { $sum: '$total_amount' } } },
    ]),
    Sale.aggregate([
      { $match: { company_id: cid, sale_date: { $gte: yearStart } } },
      { $group: { _id: null, total: { $sum: '$total_amount' } } },
    ]),
    // Top Products
    Sale.aggregate([
      { $match: { company_id: cid } },
      { $group: { _id: '$product_id', total_qty: { $sum: '$qty' }, total_sales: { $sum: '$total_amount' } } },
      { $sort: { total_sales: -1 } },
      { $limit: 5 },
      { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'product' } },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      { $project: { name: '$product.name', code: '$product.code', total_qty: 1, total_sales: 1 } },
    ]),
    // Top Customers (all roles)
    Sale.aggregate([
      { $match: { company_id: cid } },
      { $group: { _id: '$customer_id', order_count: { $sum: 1 }, total_sales: { $sum: '$total_amount' } } },
      { $sort: { total_sales: -1 } },
      { $limit: 10 },
      { $lookup: { from: 'customers', localField: '_id', foreignField: '_id', as: 'customer' } },
      { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
      { $project: { name: '$customer.name', mobile: '$customer.mobile', order_count: 1, total_sales: 1 } },
    ]),
    // Recent Enquiries
    Enquiry.find({ company_id: cid })
      .select('enq_code retailer_name product_name qty unit status created_at')
      .sort({ created_at: -1 })
      .limit(5)
      .lean(),
    // Top Retailers — Orders where customer is a Retailer user
    Order.aggregate([
      { $match: { company_id: cid, status: 'Delivered' } },
      {
        $lookup: {
          from:         'customers',
          localField:   'customer_id',
          foreignField: '_id',
          as:           'cust',
        },
      },
      { $unwind: { path: '$cust', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from:         'users',
          localField:   'cust.user_id',
          foreignField: '_id',
          as:           'usr',
        },
      },
      { $unwind: { path: '$usr', preserveNullAndEmptyArrays: true } },
      { $match: { 'usr.role': 'Retailer' } },
      {
        $group: {
          _id:         '$customer_id',
          name:        { $first: '$customer_name' },
          order_count: { $sum: 1 },
          total_sales: { $sum: '$total_amount' },
        },
      },
      { $sort: { total_sales: -1 } },
      { $limit: 5 },
      { $project: { name: 1, order_count: 1, total_sales: 1, type: { $literal: 'Retailer' } } },
    ]),
    // Top Wholesalers
    Order.aggregate([
      { $match: { company_id: cid, status: 'Delivered' } },
      {
        $lookup: {
          from:         'customers',
          localField:   'customer_id',
          foreignField: '_id',
          as:           'cust',
        },
      },
      { $unwind: { path: '$cust', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from:         'users',
          localField:   'cust.user_id',
          foreignField: '_id',
          as:           'usr',
        },
      },
      { $unwind: { path: '$usr', preserveNullAndEmptyArrays: true } },
      { $match: { 'usr.role': 'Wholesaler' } },
      {
        $group: {
          _id:         '$customer_id',
          name:        { $first: '$customer_name' },
          order_count: { $sum: 1 },
          total_sales: { $sum: '$total_amount' },
        },
      },
      { $sort: { total_sales: -1 } },
      { $limit: 5 },
      { $project: { name: 1, order_count: 1, total_sales: 1, type: { $literal: 'Wholesaler' } } },
    ]),
    // 6-month trend
    Sale.aggregate([
      { $match: { company_id: cid, sale_date: { $exists: true, $ne: null } } },
      {
        $group: {
          _id:   { year: { $year: '$sale_date' }, month: { $month: '$sale_date' } },
          sales: { $sum: '$total_amount' },
        },
      },
      { $sort: { '_id.year': -1, '_id.month': -1 } },
      { $limit: 6 },
      {
        $project: {
          _id:   0,
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
  ]);

  sendSuccess(res, {
    totalCustomers,
    totalProducts,
    totalEnquiries,
    totalOrders,
    totalDispatches,
    pendingOrders,
    lowStockCount,
    totalOutstanding:  totalOutstanding[0]?.total || 0,
    todaySales:        todaySales[0]?.total        || 0,
    monthSales:        monthSales[0]?.total        || 0,
    yearSales:         yearSales[0]?.total         || 0,
    topProducts,
    topCustomers,
    topRetailers:      topRetailersAgg,
    topWholesalers:    topWholesalersAgg,
    recentEnquiries,
    trend:             trend.reverse(),
  });
}

module.exports = { getDashboardStats };
