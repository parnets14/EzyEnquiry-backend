const { sendSuccess, sendError } = require('../../utils/helpers');
const Customer    = require('../../models/CRM Management/Customer');
const Product     = require('../../models/Product Management/Product');
const Enquiry     = require('../../models/Marketplace Management/Enquiry');
const Order       = require('../../models/Marketplace Management/Order');
const Dispatch    = require('../../models/Marketplace Management/Dispatch');
const Sale        = require('../../models/Finance Management/Sale');
const Inventory   = require('../../models/Purchase & Inventory Management/Inventory');
const Receivable  = require('../../models/Finance Management/Receivable');
const mongoose    = require('mongoose');

/** GET /api/reports/dashboard */
async function getDashboardStats(req, res) {
  const cid = new mongoose.Types.ObjectId(req.user.company_id.toString());

  const today      = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow   = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const yearStart  = new Date(today.getFullYear(), 0, 1);

  const [
    totalCustomers, totalProducts, totalEnquiries, totalOrders,
    totalDispatches, pendingOrders, lowStockCount,
    totalOutstanding, todaySales, monthSales, yearSales,
    topProducts, topCustomers, recentEnquiries,
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
    Sale.aggregate([
      { $match: { company_id: cid } },
      { $group: { _id: '$product_id', total_qty: { $sum: '$qty' }, total_sales: { $sum: '$total_amount' } } },
      { $sort: { total_sales: -1 } },
      { $limit: 5 },
      { $lookup: { from: 'products', localField: '_id', foreignField: '_id', as: 'product' } },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      { $project: { name: '$product.name', code: '$product.code', total_qty: 1, total_sales: 1 } },
    ]),
    Sale.aggregate([
      { $match: { company_id: cid } },
      { $group: { _id: '$customer_id', order_count: { $sum: 1 }, total_sales: { $sum: '$total_amount' } } },
      { $sort: { total_sales: -1 } },
      { $limit: 5 },
      { $lookup: { from: 'customers', localField: '_id', foreignField: '_id', as: 'customer' } },
      { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
      { $project: { name: '$customer.name', mobile: '$customer.mobile', order_count: 1, total_sales: 1 } },
    ]),
    Enquiry.find({ company_id: cid })
      .select('enq_code retailer_name product_name qty unit status created_at')
      .sort({ created_at: -1 })
      .limit(5)
      .lean(),
  ]);

  sendSuccess(res, {
    totalCustomers,
    totalProducts,
    totalEnquiries,
    totalOrders,
    totalDispatches,
    pendingOrders,
    lowStockCount,
    totalOutstanding: totalOutstanding[0]?.total || 0,
    todaySales:       todaySales[0]?.total        || 0,
    monthSales:       monthSales[0]?.total        || 0,
    yearSales:        yearSales[0]?.total         || 0,
    topProducts,
    topCustomers,
    recentEnquiries,
  });
}

module.exports = { getDashboardStats };
