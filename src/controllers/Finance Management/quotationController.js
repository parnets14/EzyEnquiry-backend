const { sendSuccess, sendError } = require('../../utils/helpers');
const Quotation = require('../../models/Finance Management/Quotation');
const Order = require('../../models/Marketplace Management/Order');
const Purchase = require('../../models/Purchase & Inventory Management/Purchase');
const Sale = require('../../models/Finance Management/Sale');
const Notification = require('../../models/System Management/Notification');
const User = require('../../models/User Management/User');
const Enquiry = require('../../models/Marketplace Management/Enquiry');
const Company = require('../../models/Company Management/Company');
const crypto = require('crypto');

// Resolve the retailer/creator display name for a quotation. Prefers the stored
// created_by_name; otherwise derives it from the buyer company (and creator user).
async function resolveCreatedByName(q) {
  if (q.created_by_name) return q.created_by_name;
  let companyName = '';
  if (q.buyer_company_id) {
    const co = await Company.findById(q.buyer_company_id).select('name').lean().catch(() => null);
    companyName = co?.name || '';
  }
  let userName = '';
  if (q.created_by) {
    const u = await User.findById(q.created_by).select('name').lean().catch(() => null);
    userName = u?.name || '';
  }
  if (companyName && userName && companyName !== userName) return `${companyName} (${userName})`;
  return companyName || userName || '';
}
let notifyRetailer = () => {};
try { ({ notifyRetailer } = require('../../utils/pushHelper')); } catch { /* push optional */ }

const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

// When an Admin accepts a retailer-originated quotation, fan out to create the
// order, purchase, and sale (all under the Admin company), make the order
// retailer-visible via buyer ids, and notify the retailer.
async function fanOutAcceptedQuotation(quotation, req) {
  const item = (quotation.items && quotation.items[0]) || {};
  const qty = num(item.qty, 1);
  const rate = num(item.rate, num(item.retail_price, num(item.mrp, 0)));
  const gstPercent = num(item.gst_percent, 18);
  const amount = qty * rate;
  const discount = num(quotation.subtotal) ? Math.max(0, amount - num(quotation.subtotal)) : num(item.disc, 0);
  const gstAmount = num(quotation.gst_amount, (Math.max(0, amount - discount)) * gstPercent / 100);
  const totalAmount = num(quotation.grand_total, amount + gstAmount);
  const year = new Date().getFullYear();
  const rand = () => crypto.randomInt(100, 999);

  // Resolve the retailer user (for buyer_user_id + notification target).
  let buyerUserId = quotation.buyer_user_id || quotation.created_by || null;
  let buyerCompanyId = quotation.buyer_company_id || null;
  if (!buyerCompanyId && buyerUserId) {
    const u = await User.findById(buyerUserId).select('company_id').lean().catch(() => null);
    buyerCompanyId = u?.company_id || null;
  }

  // ── Order (visible in CRM via company_id; in retailer app via buyer ids) ──
  const order = await Order.create({
    order_code: `ORD-${year}-${Date.now().toString(36).toUpperCase()}-${rand()}`,
    company_id: quotation.company_id,
    buyer_company_id: buyerCompanyId,
    buyer_user_id: buyerUserId,
    seller_company_id: quotation.company_id,
    enquiry_code: quotation.enquiry_no || '',
    customer_name: quotation.customer_name || 'Customer',
    customer_mobile: quotation.customer_phone || '',
    customer_email: quotation.customer_email || '',
    delivery_address: quotation.delivery_no || '',
    location: quotation.delivery_no || '',
    product_id: item.product_id || null,
    product_code: item.product_code || '',
    product_name: item.product_name || '',
    unit: item.unit || 'Pcs',
    qty,
    rate,
    amount,
    gst_percent: gstPercent,
    gst_amount: gstAmount,
    transport_cost: num(quotation.freight_charges),
    other_cost: num(quotation.other_charges),
    total_amount: totalAmount,
    status: 'New',
    order_date: new Date(),
    created_by: quotation.created_by || req.user._id,
    // Carry the retailer (quotation creator) so every downstream view shows
    // who generated it — not the admin who accepted it.
    created_by_name: quotation.created_by_name || req.user.name || '',
    created_by_company: quotation.created_by_company || '',
    created_by_person: quotation.created_by_person || '',
    created_by_mobile: quotation.created_by_mobile || '',
    created_by_email: quotation.created_by_email || '',
    created_by_type: quotation.created_by_type || (quotation.buyer_company_id ? 'Retailer App' : 'Admin'),
    status_history: [{
      status: 'New', updated_by: req.user._id, updated_by_name: req.user.name || '',
      updated_by_role: req.user.role || 'Admin', remarks: `Created from quotation ${quotation.quotation_no}`, timestamp: new Date(),
    }],
    notes: `Auto-created from accepted quotation ${quotation.quotation_no}`,
  });

  // ── Purchase (admin procurement record) ──
  const lastPurchase = await Purchase.findOne({ company_id: quotation.company_id, purchase_code: /^PUR-/ })
    .sort({ created_at: -1 }).select('purchase_code').lean().catch(() => null);
  const lastPurNum = lastPurchase?.purchase_code ? parseInt(String(lastPurchase.purchase_code).split('-')[1], 10) : 0;
  const purchaseCode = `PUR-${String((Number.isFinite(lastPurNum) ? lastPurNum : 0) + 1).padStart(4, '0')}`;
  await Purchase.create({
    purchase_code: purchaseCode,
    company_id: quotation.company_id,
    supplier_name: quotation.customer_name || 'Retailer Order',
    product_id: item.product_id || null,
    product_code: item.product_code || '',
    product_name: item.product_name || '',
    qty,
    unit: item.unit || '',
    rate,
    amount,
    gst_percent: gstPercent,
    gst_amount: gstAmount,
    total_amount: totalAmount,
    purchase_date: new Date(),
    status: 'Pending',
    notes: `Auto-created from accepted quotation ${quotation.quotation_no}`,
    created_by: req.user._id,
  }).catch(() => {});

  // ── Sale (admin sales record; linked to the order, idempotent by order_id) ──
  await Sale.create({
    company_id: quotation.company_id,
    order_id: order._id,
    customer_name: quotation.customer_name || 'Customer',
    product_id: item.product_id || null,
    product_code: item.product_code || '',
    product_name: item.product_name || '',
    qty,
    rate,
    amount,
    gst_percent: gstPercent,
    gst_amount: gstAmount,
    total_amount: totalAmount,
    discount,
    grand_total: totalAmount,
    sale_status: 'Confirmed',
    sale_date: new Date(),
    notes: `Auto-created from accepted quotation ${quotation.quotation_no}`,
    created_by: req.user._id,
  }).catch(() => {});

  // Link the order back onto the quotation and mark it converted.
  await Quotation.updateOne({ _id: quotation._id }, { order_id: order._id, status: 'converted' }).catch(() => {});

  // Mark the retailer's mirror enquiry as Confirmed (shown as "Accepted") and
  // link the order so the retailer can open it.
  if (quotation.enquiry_id) {
    await Enquiry.updateOne({ _id: quotation.enquiry_id }, { status: 'Confirmed', order_id: order._id }).catch(() => {});
  }

  // ── Notify the retailer (in-app + push) ──
  if (buyerCompanyId && buyerUserId) {
    await Notification.create({
      company_id: buyerCompanyId,
      user_id: buyerUserId,
      type: 'quotation_accepted',
      title: `Quotation ${quotation.quotation_no} accepted`,
      message: `Your quotation was accepted. Order ${order.order_code} has been created.`,
      reference_id: order._id,
    }).catch(() => {});
    notifyRetailer(buyerUserId, {
      title: 'Quotation Accepted',
      body: `Order ${order.order_code} created for ${item.product_name || 'your product'}.`,
      type: 'quotation_accepted',
      referenceId: order._id,
    });
  }

  return order;
}

/** GET /api/quotations */
async function listQuotations(req, res) {
  const { search, status, page = 1, limit = 200 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const query = { company_id: req.user.company_id };
  if (status) query.status = status;
  if (search) {
    query.$or = [
      { quotation_no:   { $regex: search, $options: 'i' } },
      { customer_name:  { $regex: search, $options: 'i' } },
      { customer_phone: { $regex: search, $options: 'i' } },
      { enquiry_no:     { $regex: search, $options: 'i' } },
    ];
  }

  const [total, quotations] = await Promise.all([
    Quotation.countDocuments(query),
    Quotation.find(query).sort({ created_at: -1 }).skip(offset).limit(parseInt(limit)).lean(),
  ]);
  // Backfill the retailer/creator display name for rows that don't have it
  // stored (older quotations), deriving it from the buyer company.
  await Promise.all(quotations.map(async (q) => {
    if (!q.created_by_name) q.created_by_name = await resolveCreatedByName(q);
  }));
  sendSuccess(res, { quotations, total, page: parseInt(page), limit: parseInt(limit) });
}

/** GET /api/quotations/:id */
async function getQuotation(req, res) {
  const q = await Quotation.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
  if (!q) return sendError(res, 'Quotation not found.', 404);
  if (!q.created_by_name) q.created_by_name = await resolveCreatedByName(q);
  sendSuccess(res, q);
}

/** POST /api/quotations */
async function createQuotation(req, res) {
  const body = req.body;

  // Auto-generate quotation_no if not provided
  let quotation_no = (body.quotation_no || '').trim();
  if (!quotation_no) {
    const last = await Quotation.findOne({ company_id: req.user.company_id, quotation_no: /^QT-/ }).sort({ created_at: -1 }).lean();
    const num  = last?.quotation_no ? parseInt(last.quotation_no.split('-')[1], 10) : 0;
    quotation_no = `QT-${String(num + 1).padStart(4, '0')}`;
  }

  const q = await Quotation.create({
    company_id:      req.user.company_id,
    quotation_no,
    enquiry_id:      body.enquiry_id      || null,
    enquiry_no:      body.enquiry_no      || '',
    delivery_no:     body.delivery_no     || '',
    customer_name:   body.customer_name   || '',
    customer_phone:  body.customer_phone  || '',
    customer_email:  body.customer_email  || '',
    quotation_date:  body.quotation_date  || new Date(),
    valid_until:     body.valid_until     || null,
    items:           Array.isArray(body.items) ? body.items : [],
    freight_charges: parseFloat(body.freight_charges) || 0,
    other_charges:   parseFloat(body.other_charges)   || 0,
    subtotal:        parseFloat(body.subtotal)         || 0,
    gst_amount:      parseFloat(body.gst_amount)       || 0,
    grand_total:     parseFloat(body.grand_total)      || 0,
    remarks:         body.remarks || '',
    terms:           body.terms   || '',
    status:          'draft',
    created_by:      req.user._id,
  });
  sendSuccess(res, q, 'Quotation created.', 201);
}

/** PUT /api/quotations/:id */
async function updateQuotation(req, res) {
  const body = req.body;
  const update = {};
  if (body.enquiry_id      !== undefined) update.enquiry_id      = body.enquiry_id || null;
  if (body.enquiry_no      !== undefined) update.enquiry_no      = body.enquiry_no;
  if (body.delivery_no     !== undefined) update.delivery_no     = body.delivery_no;
  if (body.customer_name   !== undefined) update.customer_name   = body.customer_name;
  if (body.customer_phone  !== undefined) update.customer_phone  = body.customer_phone;
  if (body.customer_email  !== undefined) update.customer_email  = body.customer_email;
  if (body.quotation_date  !== undefined) update.quotation_date  = body.quotation_date;
  if (body.valid_until     !== undefined) update.valid_until     = body.valid_until || null;
  if (body.items           !== undefined) update.items           = Array.isArray(body.items) ? body.items : [];
  if (body.freight_charges !== undefined) update.freight_charges = parseFloat(body.freight_charges) || 0;
  if (body.other_charges   !== undefined) update.other_charges   = parseFloat(body.other_charges)   || 0;
  if (body.subtotal        !== undefined) update.subtotal        = parseFloat(body.subtotal)         || 0;
  if (body.gst_amount      !== undefined) update.gst_amount      = parseFloat(body.gst_amount)       || 0;
  if (body.grand_total     !== undefined) update.grand_total     = parseFloat(body.grand_total)      || 0;
  if (body.remarks         !== undefined) update.remarks         = body.remarks;
  if (body.terms           !== undefined) update.terms           = body.terms;

  const q = await Quotation.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    update,
    { new: true }
  ).lean();
  if (!q) return sendError(res, 'Quotation not found.', 404);
  sendSuccess(res, q, 'Quotation updated.');
}

/** PATCH /api/quotations/:id/status */
async function updateQuotationStatus(req, res) {
  const { status } = req.body;
  const VALID = ['draft', 'sent', 'accepted', 'converted', 'expired', 'cancelled'];
  if (!status || !VALID.includes(status)) return sendError(res, `Invalid status. Valid: ${VALID.join(', ')}`);

  const existing = await Quotation.findOne({ _id: req.params.id, company_id: req.user.company_id });
  if (!existing) return sendError(res, 'Quotation not found.', 404);

  // Accepting a retailer quotation fans out into Order + Purchase + Sale and
  // notifies the retailer. Guard against re-running if already converted.
  const alreadyFannedOut = existing.status === 'accepted' || existing.status === 'converted';
  if (status === 'accepted' && !alreadyFannedOut) {
    try {
      const order = await fanOutAcceptedQuotation(existing, req);
      const updated = await Quotation.findById(existing._id).lean();
      return sendSuccess(res, updated, `Quotation accepted. Order ${order.order_code} created.`);
    } catch (err) {
      return sendError(res, `Could not accept quotation: ${err.message}`, 500);
    }
  }

  existing.status = status;
  await existing.save();

  // Notify the retailer when their quotation is rejected/cancelled.
  if ((status === 'cancelled' || status === 'expired') && existing.buyer_company_id && existing.buyer_user_id) {
    if (existing.enquiry_id) {
      await Enquiry.updateOne({ _id: existing.enquiry_id }, { status: 'Cancelled' }).catch(() => {});
    }
    await Notification.create({
      company_id: existing.buyer_company_id,
      user_id: existing.buyer_user_id,
      type: 'quotation_rejected',
      title: `Quotation ${existing.quotation_no} ${status === 'cancelled' ? 'rejected' : 'expired'}`,
      message: `Your quotation ${existing.quotation_no} was ${status === 'cancelled' ? 'rejected' : 'marked expired'} by the seller.`,
      reference_id: existing._id,
    }).catch(() => {});
    notifyRetailer(existing.buyer_user_id, {
      title: `Quotation ${status === 'cancelled' ? 'Rejected' : 'Expired'}`,
      body: `Quotation ${existing.quotation_no} was ${status === 'cancelled' ? 'rejected' : 'expired'}.`,
      type: 'quotation_rejected',
      referenceId: existing._id,
    });
  }

  sendSuccess(res, existing.toObject(), `Status updated to ${status}.`);
}

/** DELETE /api/quotations/:id */
async function deleteQuotation(req, res) {
  const quotation = await Quotation.findOne({ _id: req.params.id, company_id: req.user.company_id }).lean();
  if (!quotation) return sendError(res, 'Quotation not found.', 404);

  await Quotation.deleteOne({ _id: quotation._id, company_id: req.user.company_id });

  // Remove the linked retailer enquiry so it also disappears from the retailer
  // app. Match by the stored enquiry_id first; fall back to the enquiry_no /
  // buyer for older quotations that weren't linked at creation.
  const enquiryOr = [];
  if (quotation.enquiry_id) enquiryOr.push({ _id: quotation.enquiry_id });
  if (quotation.enquiry_no) enquiryOr.push({ enq_code: quotation.enquiry_no });
  if (quotation.buyer_company_id && quotation.buyer_user_id) {
    enquiryOr.push({ buyer_company_id: quotation.buyer_company_id, buyer_user_id: quotation.buyer_user_id, product_name: (quotation.items?.[0]?.product_name || '') });
  }
  let deletedEnquiries = 0;
  if (enquiryOr.length) {
    const del = await Enquiry.deleteMany({ $or: enquiryOr }).catch(() => ({ deletedCount: 0 }));
    deletedEnquiries = del?.deletedCount || 0;
  }
  console.log('[deleteQuotation]', {
    quotation_no: quotation.quotation_no,
    enquiry_id: String(quotation.enquiry_id || ''),
    enquiry_no: quotation.enquiry_no || '',
    matchers: enquiryOr.length,
    deletedEnquiries,
  });
  if (quotation.buyer_company_id && quotation.buyer_user_id) {
    await Notification.create({
      company_id: quotation.buyer_company_id,
      user_id: quotation.buyer_user_id,
      type: 'enquiry_deleted',
      title: `Enquiry ${quotation.enquiry_no || quotation.quotation_no} removed`,
      message: 'Your enquiry was removed by the seller.',
      reference_id: quotation._id,
    }).catch(() => {});
    notifyRetailer(quotation.buyer_user_id, {
      title: 'Enquiry removed',
      body: `Your enquiry ${quotation.enquiry_no || quotation.quotation_no} was removed.`,
      type: 'enquiry_deleted',
      referenceId: quotation._id,
    });
  }

  sendSuccess(res, null, 'Quotation and linked enquiry deleted.');
}

module.exports = { listQuotations, getQuotation, createQuotation, updateQuotation, updateQuotationStatus, deleteQuotation };
