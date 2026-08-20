const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const Sale = require('../../models/Finance Management/Sale');
const mongoose = require('mongoose');

/** GET /api/sales */
async function listSales(req, res) {
  const { search, payment_status, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = { company_id: req.user.company_id };
  if (search) {
    query.$or = [
      { customer_name: { $regex: search, $options: 'i' } },
      { product_name:  { $regex: search, $options: 'i' } },
      { sale_code:     { $regex: search, $options: 'i' } },
    ];
  }
  if (payment_status && payment_status !== 'All') query.payment_status = payment_status;

  const [total, sales] = await Promise.all([
    Sale.countDocuments(query),
    Sale.find(query).sort({ sale_date: -1 }).skip(offset).limit(parseInt(limit)).lean(),
  ]);
  sendSuccess(res, { sales, pagination: paginate(total, parseInt(page), parseInt(limit)) });
}

/** POST /api/sales */
async function createSale(req, res) {
  const { customer_name, qty, rate } = req.body;
  if (!customer_name || !qty || !rate) return sendError(res, 'Customer name, qty and rate are required.');

  const gst_percent  = parseFloat(req.body.gst_percent || 18);
  const amount       = parseFloat(qty) * parseFloat(rate);
  const gst_amount   = Math.round(amount * gst_percent / 100);
  const total_amount = amount + gst_amount;

  const last = await Sale.findOne({ sale_code: /^SAL-/ }).sort({ sale_code: -1 }).lean();
  const num  = last?.sale_code ? parseInt(last.sale_code.split('-')[1], 10) : 0;
  const sale_code = `SAL-${String(num + 1).padStart(4, '0')}`;

  const sale = await Sale.create({
    ...req.body,
    sale_code,
    company_id:     req.user.company_id,
    amount,
    gst_amount,
    total_amount,
    payment_status: req.body.payment_status || 'Pending',
    sale_date:      req.body.sale_date      || new Date(),
  });
  sendSuccess(res, sale, 'Sale entry created.', 201);
}

module.exports = { listSales, createSale };
