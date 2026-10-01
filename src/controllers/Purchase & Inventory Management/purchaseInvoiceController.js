const Purchase = require('../../models/Purchase & Inventory Management/Purchase');
const { sendSuccess, sendError, paginate } = require('../../utils/helpers');

async function list(req, res) {
  const { search, payment_status, from_date, to_date, page = 1, limit = 100 } = req.query;
  const query = {
    company_id: req.user.company_id,
    $or: [
      { invoice_number: { $exists: true, $ne: '' } },
      { bill_code: { $exists: true, $ne: '' } },
    ],
  };
  if (payment_status) query.payment_status = payment_status;
  if (from_date || to_date) {
    query.purchase_date = {};
    if (from_date) query.purchase_date.$gte = new Date(from_date);
    if (to_date) query.purchase_date.$lte = new Date(new Date(to_date).setHours(23, 59, 59, 999));
  }
  if (search) {
    query.$and = [{ $or: [
      { invoice_number: { $regex: search, $options: 'i' } },
      { bill_code: { $regex: search, $options: 'i' } },
      { purchase_code: { $regex: search, $options: 'i' } },
      { supplier_name: { $regex: search, $options: 'i' } },
      { product_name: { $regex: search, $options: 'i' } },
    ] }];
  }

  const currentPage = Math.max(1, parseInt(page, 10) || 1);
  const pageLimit = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));
  const [total, purchases] = await Promise.all([
    Purchase.countDocuments(query),
    Purchase.find(query).sort({ purchase_date: -1, created_at: -1 }).skip((currentPage - 1) * pageLimit).limit(pageLimit).lean(),
  ]);
  sendSuccess(res, { purchases, pagination: paginate(total, currentPage, pageLimit) });
}

async function recordPayment(req, res) {
  const paid = Number(req.body.amount_paid);
  if (!Number.isFinite(paid) || paid < 0) return sendError(res, 'Enter a valid payment amount.', 400);

  const selector = {
    company_id: req.user.company_id,
    $or: [
      { bill_code: req.params.billCode },
      { purchase_code: req.params.billCode },
    ],
  };
  const purchases = await Purchase.find(selector).sort({ created_at: 1, _id: 1 });
  if (!purchases.length) return sendError(res, 'Purchase bill not found.', 404);

  const billTotal = purchases.reduce((sum, purchase) => sum + Number(purchase.total_amount || 0), 0);
  if (paid > billTotal) return sendError(res, 'Payment cannot exceed the bill total.', 400);

  const dueDate = req.body.due_date ? new Date(req.body.due_date) : purchases[0].due_date;
  if (req.body.due_date && Number.isNaN(dueDate.getTime())) return sendError(res, 'Enter a valid due date.', 400);

  let remaining = paid;
  const operations = purchases.map(purchase => {
    const lineTotal = Number(purchase.total_amount || 0);
    const linePaid = Math.min(remaining, lineTotal);
    remaining -= linePaid;
    let payment_status = linePaid >= lineTotal ? 'Paid' : linePaid > 0 ? 'Partially Paid' : 'Due';
    if (payment_status !== 'Paid' && dueDate && dueDate < new Date()) payment_status = 'Overdue';
    return {
      updateOne: {
        filter: { _id: purchase._id, company_id: req.user.company_id },
        update: { $set: {
          amount_paid: linePaid,
          payment_status,
          payment_notes: req.body.payment_notes || '',
          due_date: dueDate || null,
        } },
      },
    };
  });

  await Purchase.bulkWrite(operations);
  const updated = await Purchase.find(selector).sort({ created_at: 1, _id: 1 }).lean();
  sendSuccess(res, { bill_code: req.params.billCode, purchases: updated }, 'Bill payment recorded.');
}

module.exports = { list, recordPayment };
