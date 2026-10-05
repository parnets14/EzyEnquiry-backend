const crypto       = require('crypto');
const { sendSuccess, sendError, paginate } = require('../../utils/helpers');
const Enquiry        = require('../../models/Marketplace Management/Enquiry');
const EnquiryMessage = require('../../models/Marketplace Management/EnquiryMessage');
const EnquiryReplyHistory = require('../../models/Marketplace Management/EnquiryReplyHistory');
const Notification   = require('../../models/System Management/Notification');
const Company        = require('../../models/Company Management/Company');
const mongoose       = require('mongoose');
const { notifySeller } = require('../../utils/pushHelper');

// ── Role sets ────────────────────────────────────────────────
// 'Retailer' / 'RetailerStaff' are reply roles too: a retailer that RECEIVES a
// broadcast must be able to answer it with availability + price. The
// buyer-side guard inside updateEnquiry stops them rewriting an enquiry they
// raised themselves, so widening this list is safe.
//
// 'Wholesaler' is BOTH a creator and a recipient: a wholesaler may raise a
// broadcast (e.g. sourcing material it does not stock) that goes to every
// approved retailer, every approved wholesaler and the Admin team — the same
// fan-out a retailer gets. `broadcastEnquiry` excludes the sender's own company
// by `_id`, so a wholesaler never receives its own broadcast back.
const ENQUIRY_CREATOR_ROLES = ['Retailer', 'Wholesaler', 'Sales Executive', 'Manager', 'Company Owner', 'Super Admin'];
const ENQUIRY_REPLY_ROLES   = ['Wholesaler', 'Retailer', 'RetailerStaff', 'Manager', 'Company Owner', 'Super Admin'];
const SEE_ALL_ROLES         = ['Wholesaler', 'Manager', 'Accountant', 'Company Owner', 'Super Admin', 'Warehouse Staff', 'Sales Executive'];

// Marketplace participants are the customers/sellers on the platform; every
// other role (back-office / ERP / CRM) is an "operator" who may open any
// enquiry they facilitate. Used to decide message/offer visibility so a read
// endpoint never leaks one participant's thread to another.
const MARKETPLACE_ROLES = ['Retailer', 'RetailerStaff', 'Wholesaler'];
function isOperator(user) {
  return !!user && !MARKETPLACE_ROLES.includes(user.role);
}

// Local mirror of retailerMarketplaceController.offerResponse. Kept here (not
// imported) so the buyer / operator offer list reuses the exact seller-endpoint
// shape without coupling the two controllers (avoids a circular require).
function shapeOffer(offer) {
  const seller = offer.seller_company_id || {};
  return {
    id: offer._id,
    enquiry_id: offer.enquiry_id,
    status: offer.status,
    qty: offer.qty,
    unit: offer.unit,
    unit_price: offer.unit_price,
    gst_percent: offer.gst_percent,
    amount: offer.amount,
    gst_amount: offer.gst_amount,
    charges: { transport: offer.transport_charge, packing: offer.packing_charge, other: offer.other_charge },
    total_amount: offer.total_amount,
    available_quantity: offer.available_quantity ?? null,
    delivery_timeline: offer.delivery_timeline || '',
    notes: offer.notes || '',
    seller: seller?._id ? { id: seller._id, name: seller.name || '', city: seller.city || '', state: seller.state || '' } : null,
    responded_at: offer.responded_at,
    created_at: offer.created_at,
    updated_at: offer.updated_at,
  };
}

// The Enquiry model has no dedicated category/brand/size/… columns, so a
// free-text description is composed into `remarks`. Shared by the broadcast
// path here and mirrored (separately) in retailerMarketplaceController.
function composeSpecRemarks(body = {}) {
  return [
    body.category ? `Category: ${String(body.category).trim()}` : '',
    body.brand    ? `Brand: ${String(body.brand).trim()}`       : '',
    body.size     ? `Size: ${String(body.size).trim()}`         : '',
    body.finish   ? `Finish: ${String(body.finish).trim()}`     : '',
    body.colour   ? `Colour: ${String(body.colour).trim()}`     : '',
    body.material ? `Material: ${String(body.material).trim()}` : '',
    body.surface  ? `Surface: ${String(body.surface).trim()}`   : '',
    body.grade    ? `Grade: ${String(body.grade).trim()}`       : '',
    body.thickness ? `Thickness: ${String(body.thickness).trim()}` : '',
    body.tile_type ? `Tile Type: ${String(body.tile_type).trim()}` : '',
    body.details  ? `Details: ${String(body.details).trim()}`   : '',
    body.remarks  ? `Notes: ${String(body.remarks).trim()}`     : '',
  ].filter(Boolean).join('\n').slice(0, 2000);
}

// ── Broadcast: the sender asks EVERY retailer / EVERY wholesaler / both ──────
// Raised from the CRM's Market Management. The schema holds a single
// `company_id`, so "send to everyone" is one row per recipient — and every row
// is stamped with `broadcast_owner_company_id` so the SENDER can still list the
// broadcast and read the replies (`listEnquiries` is otherwise scoped to
// `company_id`, which on these rows is the RECIPIENT).
async function broadcastEnquiry(req, res) {
  const body = req.body || {};
  const audience = ['retailers', 'wholesalers', 'both'].includes(String(body.audience))
    ? String(body.audience)
    : 'both';

  const productName = String(body.product_name || '').trim();
  if (!productName) return sendError(res, 'Product name is required.');

  const qty = Number(body.qty);
  if (!Number.isFinite(qty) || qty <= 0) return sendError(res, 'qty must be greater than zero.');

  // biz_type is FREE TEXT, entered at signup, so it arrives as "Retailer",
  // "Retailers", "Wholesaler", "Wholesalers", and — seen in production —
  // "Wholesale" (no trailing "r"). A pattern of /^wholesalers?$/i silently
  // dropped every "Wholesale" company, so a real wholesaler never received the
  // broadcast. Match on the STEM with a substring instead, which covers all the
  // variants without also swallowing unrelated values.
  const filters = [];
  if (audience === 'retailers' || audience === 'both') filters.push('retailer');
  if (audience === 'wholesalers' || audience === 'both') filters.push('wholesale');

  // Case-insensitive substring match on the stem, run in-query so the DB does
  // the filtering (biz_type values are short; the list is bounded).
  const bizOr = filters.map(f => ({ biz_type: { $regex: f, $options: 'i' } }));

  const recipients = await Company.find({
    ...(bizOr.length ? { $or: bizOr } : {}),
    status: 'Approved',
    is_active: { $ne: false },
    // ── NEVER the sender's own company ──────────────────────────────────────
    // The seeded Admin company is `biz_type: 'Wholesaler'` (utils/seeder.js), so
    // it MATCHES this filter. Without the exclusion an Admin broadcast addressed
    // itself, and that row then showed up in the Admin's own RECEIVED tab as
    // well as its SENT tab — i.e. it looked like the enquiry was created twice.
    _id: { $ne: req.user.company_id },
  }).select('_id owner_user_id name').lean();

  if (!recipients.length) {
    return sendError(res, `No approved ${audience === 'both' ? 'retailer or wholesaler' : audience} company is available to receive this enquiry.`, 409);
  }

  const unit = String(body.unit || 'Pcs').trim() || 'Pcs';
  // 'BC-' (broadcast) is a deliberate third prefix. 'ENQ-' rows with no matching
  // Quotation get swept away by the retailer-side list, and 'REQ-' is the
  // retailer's own broadcast — keeping them distinct makes the origin obvious.
  const enqCode = `BC-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}-${crypto.randomInt(100, 999)}`;
  const sender = await Company.findById(req.user.company_id).select('name mobile email').lean().catch(() => null);

  const base = {
    enq_code: enqCode,
    buyer_company_id: req.user.company_id,        // the SENDER
    buyer_user_id: req.user._id,
    retailer_name: (sender?.name || req.user.name || 'Sender').trim(),
    retailer_mobile: sender?.mobile || req.user.mobile || '',
    retailer_email: sender?.email || req.user.email || '',
    location: String(body.location || '').trim(),
    product_id: null,
    product_code: '',
    product_name: productName.slice(0, 200),
    qty,
    unit,
    remarks: composeSpecRemarks(body),
    broadcast_owner_company_id: req.user.company_id,
    broadcast_audience: audience,
    created_by: req.user._id,
    status: 'New',
  };

  const docs = await Enquiry.insertMany(
    recipients.map(c => ({ ...base, company_id: c._id, seller_company_id: c._id })),
  );

  await Promise.all(docs.map(doc => Notification.create({
    company_id: doc.company_id,
    type: 'enquiry',
    title: `New enquiry ${enqCode}`,
    message: `${base.retailer_name} enquired for ${productName} × ${qty} ${unit}`,
    reference_id: doc._id,
  }).catch(() => {})));

  for (const c of recipients) {
    if (!c.owner_user_id) continue;
    notifySeller(c.owner_user_id, {
      title: `New Enquiry ${enqCode}`,
      body: `${base.retailer_name} enquired for ${productName} × ${qty} ${unit}`,
      type: 'enquiry',
      referenceId: docs[0]._id,
    });
  }

  return sendSuccess(res, {
    broadcast: true,
    enquiry_code: enqCode,
    audience,
    recipients: docs.length,
    ids: docs.map(d => d._id),
  }, `Enquiry sent to ${docs.length} compan${docs.length === 1 ? 'y' : 'ies'}.`, 201);
}

/** GET /api/enquiries */
async function listEnquiries(req, res) {
  const { status, search, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  // The sender must also see the broadcasts it raised. A broadcast row's
  // `company_id` is the RECIPIENT, so the plain scope would hide every row the
  // sender just created — and with it every reply.
  //
  // A RECEIVED enquiry (someone else sent it TO this company) belongs to the
  // whole company — ANY logged-in user of the recipient company must see it,
  // whatever their role. "Received" means the row carries a sender:
  // `buyer_company_id` (a 1:1 enquiry raised against us) or
  // `broadcast_owner_company_id` pointing at ANOTHER company (a broadcast
  // addressed to us). So the per-user `created_by` narrowing below must only
  // ever apply to rows this company RAISED itself — never to received mail.
  const me = String(req.user.company_id);
  const receivedScope = {
    company_id: req.user.company_id,
    $or: [
      { buyer_company_id: { $ne: null, $exists: true } },
      { broadcast_owner_company_id: { $ne: null, $exists: true } },
    ],
  };
  // Rows this company RAISED: a broadcast it owns, or a legacy own-record
  // (its own company_id with no buyer set).
  const raisedScope = {
    $or: [
      { broadcast_owner_company_id: req.user.company_id },
      { company_id: req.user.company_id, buyer_company_id: null },
    ],
  };
  // A user who cannot see the whole company still sees what THEY raised; this
  // never hides a received enquiry (those are company-wide).
  if (!SEE_ALL_ROLES.includes(req.user?.role)) {
    raisedScope.$or = raisedScope.$or.map(clause => ({ ...clause, created_by: req.user._id }));
  }
  const query = { $or: [receivedScope, raisedScope] };
  if (status && status !== 'All') query.status = status;
  if (search) {
    query.$and = [
      ...(query.$and || []),
      {
        $or: [
          { retailer_name: { $regex: search, $options: 'i' } },
          { product_name:  { $regex: search, $options: 'i' } },
          { enq_code:      { $regex: search, $options: 'i' } },
        ],
      },
    ];
  }

  const [total, enquiries] = await Promise.all([
    Enquiry.countDocuments(query),
    Enquiry.find(query)
      .populate('created_by', 'name role')
      // `company_id` is the RECIPIENT on a broadcast row, so the CRM can show
      // who a sent broadcast went to instead of printing the sender's own name
      // in the "Retailer" column.
      .populate('company_id',   'name city state')
      .populate('order_id',   'order_code status invoice_number')
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(parseInt(limit))
      .lean(),
  ]);
  // Which side of each row is this company on? On a broadcast row `company_id`
  // is the RECIPIENT, so:
  //   broadcast_owner_company_id === me            → this company RAISED it
  //   company_id === me, no buyer_company_id       → legacy own record → raised
  //   company_id === me, buyer_company_id set      → addressed TO this company
  // The UI splits its Sent / Received tabs on this rather than re-deriving it
  // (and getting it backwards) client-side. (`me` is declared above.)
  const withDirection = enquiries.map(e => ({
    ...e,
    direction: (
      (e.broadcast_owner_company_id && String(e.broadcast_owner_company_id) === me)
      || (!e.buyer_company_id && String(e.company_id?._id || e.company_id) === me)
    ) ? 'sent' : 'received',
  }));

  sendSuccess(res, {
    enquiries: withDirection,
    pagination: paginate(total, parseInt(page), parseInt(limit)),
  });
}

/** GET /api/enquiries/stats */
async function enquiryStats(req, res) {
  const rows = await Enquiry.aggregate([
    { $match: { company_id: new mongoose.Types.ObjectId(req.user.company_id.toString()) } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const stats = rows.reduce((acc, r) => ({ ...acc, [r._id]: r.count }), {});
  sendSuccess(res, stats);
}

/** GET /api/enquiries/:id */
async function getEnquiry(req, res) {
  // On a broadcast row `company_id` is the RECIPIENT, so a sender opening one of
  // its own sent enquiries would 404 with a plain `company_id` scope. The
  // ownership $or mirrors `listEnquiries` so the SENT tab's cards are openable.
  const enq = await Enquiry.findOne({
    _id: req.params.id,
    $or: [
      { company_id: req.user.company_id },
      { broadcast_owner_company_id: req.user.company_id },
    ],
  })
    .populate('product_id', 'image_urls')
    .populate('company_id', '_id')
    .lean();
  if (!enq) return sendError(res, 'Enquiry not found.', 404);

  // Stamp `direction` the SAME way listEnquiries does, so the detail screen can
  // tell SENT from RECEIVED. Without this the client defaults every opened
  // enquiry to "received" and shows reply/status actions on broadcasts the
  // company itself raised.
  const me = String(req.user.company_id);
  enq.direction = (
    (enq.broadcast_owner_company_id && String(enq.broadcast_owner_company_id) === me)
    || (!enq.buyer_company_id && String(enq.company_id?._id || enq.company_id) === me)
  ) ? 'sent' : 'received';

  sendSuccess(res, enq);
}

// ── Replies to an enquiry ────────────────────────────────────────────────────
// A broadcast is N sibling rows sharing ONE `enq_code` — one per recipient. The
// SENDER does not want N separate table rows, it wants the roster: who answered,
// what they quoted, and who is still silent. This returns both halves in one
// call so the UI can show "3 of 5 replied".
function shapeReply(row) {
  const c = row.company_id && row.company_id._id ? row.company_id : null
  return {
    id: row._id,
    // The RESPONDING company's details — this is what makes a reply actionable
    // ("Sharma Traders, Pune, ₹72/Box, 500 available").
    company: c ? {
      id: c._id,
      name: c.name || '',
      company_code: c.company_code || '',
      city: c.city || '',
      state: c.state || '',
      mobile: c.mobile || '',
      email: c.email || '',
    } : null,
    status: row.status,
    unit: row.unit || '',
    qty: row.qty,
    offered_price: row.offered_price ?? null,
    available_quantity: row.available_quantity ?? null,
    delivery_timeline: row.delivery_timeline || '',
    message: row.distributor_reply || '',
    responded_at: row.updated_at || null,
  }
}

// "Has this recipient answered?" — any one of these is enough. A recipient can
// reply with availability + price and no prose at all, which used to render as
// nothing.
function hasReplied(row) {
  return ['Replied', 'Negotiation', 'Confirmed'].includes(row.status)
    || !!String(row.distributor_reply || '').trim()
    || row.offered_price != null
    || row.available_quantity != null
}

/** GET /api/enquiries/:id/replies */
async function enquiryReplies(req, res) {
  // The caller is either the RECIPIENT (`company_id`) or the SENDER
  // (`broadcast_owner_company_id`). Scoping on `company_id` alone would 404 the
  // sender, because on a broadcast row the recipient owns it.
  const anchor = await Enquiry.findOne({
    _id: req.params.id,
    $or: [
      { company_id: req.user.company_id },
      { broadcast_owner_company_id: req.user.company_id },
    ],
  }).select('enq_code').lean();
  if (!anchor) return sendError(res, 'Enquiry not found.', 404);

  const rows = await Enquiry.find({ enq_code: anchor.enq_code })
    .populate('company_id', 'name company_code city state mobile email')
    .sort({ updated_at: -1 })
    .lean();

  const replied  = rows.filter(hasReplied).map(shapeReply);
  const awaiting = rows.filter(r => !hasReplied(r)).map(shapeReply);

  sendSuccess(res, {
    enquiry_code: anchor.enq_code,
    total: rows.length,
    counts: { total: rows.length, replied: replied.length, awaiting: awaiting.length },
    replied,
    awaiting,
  }, 'Replies retrieved.');
}

/** POST /api/enquiries */
async function createEnquiry(req, res) {
  if (!ENQUIRY_CREATOR_ROLES.includes(req.user?.role)) {
    return sendError(res, 'Only Retailers, Wholesalers and Sales staff can create enquiries.', 403);
  }

  // ── Broadcast mode: one enquiry addressed to many companies ──
  // Handled before the single-recipient validation below, because a broadcast
  // has no `retailer_name`/`retailer_mobile` (the SENDER is the logged-in user).
  if (req.body?.broadcast === true || req.body?.broadcast === 'true') {
    return broadcastEnquiry(req, res);
  }

  const { retailer_name, retailer_mobile, qty } = req.body;
  if (!retailer_name || !retailer_mobile || !qty)
    return sendError(res, 'Retailer name, mobile and qty are required.');

  // ── Enquiry-limit enforcement (per subscription plan; 0 = unlimited) ──
  const company = await Company.findById(req.user.company_id).select('enquiry_limit enquiries_used').lean();
  if (company && company.enquiry_limit > 0 && (company.enquiries_used || 0) >= company.enquiry_limit) {
    return sendError(res, `Enquiry limit reached (${company.enquiry_limit}). Please upgrade your subscription plan.`, 403);
  }

  // Auto-generate enq_code
  const last = await Enquiry.findOne({ enq_code: /^ENQ-/ }).sort({ enq_code: -1 }).lean();
  const num  = last?.enq_code ? parseInt(last.enq_code.split('-')[1], 10) : 0;
  const enq_code = `ENQ-${String(num + 1).padStart(4, '0')}`;

  const payload = {
    ...req.body,
    enq_code,
    company_id: req.user.company_id,
    created_by: req.user._id,
    status:     'New',
  };

  // The CRM's form now sends the SAME plain-text spec fields as a broadcast
  // (category / brand / size / finish / colour / grade / details), and the
  // Enquiry schema has no columns for them — so compose them into `remarks`,
  // exactly as broadcastEnquiry does. Only when specs are actually present, so
  // a caller that passes plain `remarks` keeps it verbatim rather than getting
  // a "Notes: " prefix bolted on.
  const hasSpecs = ['category', 'brand', 'size', 'finish', 'colour',
    'material', 'surface', 'grade', 'thickness', 'tile_type', 'details']
    .some(k => String(req.body?.[k] || '').trim());
  if (hasSpecs) {
    const composed = composeSpecRemarks(req.body);
    if (composed) payload.remarks = composed;
  }

  const enq = await Enquiry.create(payload);

  // Count this enquiry against the company's quota.
  await Company.findByIdAndUpdate(req.user.company_id, { $inc: { enquiries_used: 1 } }).catch(() => {});

  await Notification.create({
    company_id:   req.user.company_id,
    type:         'enquiry',
    title:        `New Enquiry — ${enq_code}`,
    message:      `New enquiry from ${retailer_name} for ${req.body.product_name || '—'} × ${qty} ${req.body.unit || 'Sq Ft'}`,
    reference_id: enq._id,
  });

  sendSuccess(res, enq, 'Enquiry created.', 201);
}

/** PATCH /api/enquiries/:id */
async function updateEnquiry(req, res) {
  const REPLY_STATUSES = ['Viewed', 'Replied', 'Negotiation', 'Confirmed', 'Cancelled'];

  // ── Find the row ─────────────────────────────────────────────────────────────
  // Three access shapes:
  //   1. company_id === me              → I am the RECIPIENT (seller/distributor)
  //   2. broadcast_owner_company_id === me → I SENT this broadcast (retailer/admin)
  //   3. buyer_company_id === me        → I am the buyer on a marketplace enquiry
  // All three must be able to write (Viewed, reply, negotiation note, etc.)
  const existing = await Enquiry.findOne({
    _id: req.params.id,
    $or: [
      { company_id: req.user.company_id },
      { broadcast_owner_company_id: req.user.company_id },
      { buyer_company_id: req.user.company_id },
    ],
  }).select('buyer_company_id broadcast_owner_company_id company_id').lean();
  if (!existing) return sendError(res, 'Enquiry not found.', 404);

  // ── Who may write what ────────────────────────────────────────────────────────
  const me = String(req.user.company_id);
  const isBroadcastOwner = existing.broadcast_owner_company_id
    && String(existing.broadcast_owner_company_id) === me;
  const isBuyer = existing.buyer_company_id
    && String(existing.buyer_company_id) === me;
  const isRecipient = String(existing.company_id) === me;

  // Enforce role for status moves
  if (req.body.status && REPLY_STATUSES.includes(req.body.status)) {
    if (!ENQUIRY_REPLY_ROLES.includes(req.user?.role)) {
      return sendError(res, 'You do not have permission to update the enquiry status.', 403);
    }
  }

  const VALID = ['New', 'Viewed', 'Replied', 'Negotiation', 'Confirmed', 'Cancelled'];
  const update = {};

  if (isRecipient || isBroadcastOwner || isBuyer) {
    // Fields any party may write
    if (req.body.status && VALID.includes(req.body.status)) update.status = req.body.status;
    if (req.body.negotiation_note  !== undefined) update.negotiation_note  = req.body.negotiation_note;
    if (req.body.order_id)                        update.order_id          = req.body.order_id;
  }

  if (isRecipient) {
    // Recipient (seller/distributor/admin) writes their quote + reply
    if (req.body.distributor_reply !== undefined)  update.distributor_reply  = req.body.distributor_reply;
    if (req.body.offered_price     !== undefined)  update.offered_price      = req.body.offered_price;
    if (req.body.available_quantity !== undefined) update.available_quantity  = req.body.available_quantity;
    if (req.body.delivery_timeline !== undefined)  update.delivery_timeline  = req.body.delivery_timeline;
    if (req.body.remarks           !== undefined)  update.remarks            = req.body.remarks;
    if (req.body.retailer_name     !== undefined)  update.retailer_name      = req.body.retailer_name;
    if (req.body.retailer_mobile   !== undefined)  update.retailer_mobile    = req.body.retailer_mobile;
    if (req.body.retailer_email    !== undefined)  update.retailer_email     = req.body.retailer_email;
    if (req.body.product_id        !== undefined)  update.product_id         = req.body.product_id || null;
    if (req.body.product_code      !== undefined)  update.product_code       = req.body.product_code;
    if (req.body.product_name      !== undefined)  update.product_name       = req.body.product_name;
    if (req.body.qty               !== undefined)  update.qty                = req.body.qty;
    if (req.body.unit              !== undefined)  update.unit               = req.body.unit;
    if (req.body.location          !== undefined)  update.location           = req.body.location;
  }

  if (isBroadcastOwner || isBuyer) {
    // Buyer/sender counter-offers or updates negotiation fields on the seller's row
    // (e.g. retailer says "I'll take 500 @ ₹140" — stored as negotiation_note
    // so the seller's original quote is preserved alongside the counter)
    if (req.body.distributor_reply !== undefined)  update.distributor_reply  = req.body.distributor_reply;
    if (req.body.offered_price     !== undefined)  update.offered_price      = req.body.offered_price;
    if (req.body.available_quantity !== undefined) update.available_quantity  = req.body.available_quantity;
    if (req.body.delivery_timeline !== undefined)  update.delivery_timeline  = req.body.delivery_timeline;
    if (req.body.remarks           !== undefined)  update.remarks            = req.body.remarks;
  }

  if (!Object.keys(update).length) {
    return sendError(res, 'Nothing to update.', 400);
  }

  // Scope the update: recipient uses company_id; buyer uses broadcast/buyer id
  const scopeQuery = isRecipient
    ? { _id: req.params.id, company_id: req.user.company_id }
    : {
        _id: req.params.id,
        $or: [
          { broadcast_owner_company_id: req.user.company_id },
          { buyer_company_id: req.user.company_id },
        ],
      };

  const enq = await Enquiry.findOneAndUpdate(scopeQuery, update, { new: true }).lean();
  if (!enq) return sendError(res, 'Enquiry not found.', 404);
  sendSuccess(res, enq, 'Enquiry updated.');
}

/** DELETE /api/enquiries/:id */
async function deleteEnquiry(req, res) {
  // ── Find the row ──────────────────────────────────────────────────────────
  // `company_id` is the RECIPIENT on a broadcast row, so scoping on it alone
  // made the SENDER's own broadcasts invisible here → Delete returned 404 and
  // looked completely broken. The sender is found via broadcast_owner_company_id.
  const enq = await Enquiry.findOne({
    _id: req.params.id,
    $or: [
      { company_id: req.user.company_id },
      { broadcast_owner_company_id: req.user.company_id },
    ],
  }).lean();
  if (!enq) return sendError(res, 'Enquiry not found.', 404);

  // ── Who may delete ─────────────────────────────────────────────────────────
  // Three shapes, three answers:
  //   1. broadcast_owner_company_id === me → I SENT it                → allowed
  //   2. company_id === me                 → it was sent TO me        → allowed
  //   3. neither, but buyer_company_id === me → I raised it and somebody else
  //      owns the row (a retailer-marketplace enquiry) → 409. Deleting it would
  //      wipe the seller's copy from under them.
  //
  // 🚨 THE TRAP: on a broadcast the SENDER is BOTH `buyer_company_id` AND
  // `broadcast_owner_company_id`. An earlier guard keyed on `buyer_company_id`
  // alone, so it matched case 1 and rejected every delete the admin attempted —
  // the 409s seen in the browser console. Always test the ownership clauses
  // BEFORE concluding the caller is "only the buyer".
  const me                = String(req.user.company_id)
  const isBroadcastOwner  = !!enq.broadcast_owner_company_id
    && String(enq.broadcast_owner_company_id) === me
  const ownsRow           = String(enq.company_id) === me
  if (!isBroadcastOwner && !ownsRow) {
    return sendError(res, 'You cannot delete an enquiry you raised — the seller still owns it.', 409)
  }

  const Order = require('../../models/Marketplace Management/Order');

  // ── Cascade: delete the linked order if it exists ───────────
  if (enq.order_id) {
    await Order.deleteOne({ _id: enq.order_id, company_id: req.user.company_id });
  }

  // ── A BROADCAST is N sibling rows sharing one enq_code ─────────────────────
  // Deleting just one recipient's copy would leave a half-deleted broadcast
  // (the table groups by code, so the row would appear to survive). When the
  // caller is the SENDER, remove every sibling.
  if (isBroadcastOwner && enq.enq_code) {
    const siblings = await Enquiry.find({ enq_code: enq.enq_code }).select('order_id').lean();
    const orderIds = siblings.map(s => s.order_id).filter(Boolean);
    if (orderIds.length) await Order.deleteMany({ _id: { $in: orderIds }, company_id: req.user.company_id });
    await Enquiry.deleteMany({ enq_code: enq.enq_code });
    return sendSuccess(res, {
      deleted_order_id: enq.order_id || null,
      deleted_count: siblings.length,
    }, 'Enquiry deleted.');
  }

  await Enquiry.deleteOne({ _id: req.params.id, company_id: req.user.company_id });

  // Return the deleted order_id so frontend can remove it from state
  sendSuccess(res, { deleted_order_id: enq.order_id || null }, 'Enquiry deleted.');
}

/**
 * Admin / ERP operator: list messages on any enquiry the operator can see.
 *
 * Used by the CRM's "Enquiry Management" detail modal so the operator can
 * follow the buyer ↔ seller conversation without joining either side. Mirrors
 * `retailerMarketplace.sellerListMessages` but with the visibility widened to
 * anyone in the operator's company that has the ENQUIRIES module access.
 *
 * Visibility: rows owned by the operator's company (either as buyer or as
 * recipient), OR broadcasts they own — same rule as `enquiryReplies`.
 */
async function adminListMessages(req, res) {
  const anchor = await Enquiry.findOne({
    _id: req.params.id,
    $or: [
      { company_id: req.user.company_id },
      { buyer_company_id: req.user.company_id },
      { broadcast_owner_company_id: req.user.company_id },
    ],
  }).select('_id enq_code').lean();
  if (!anchor) return sendError(res, 'Enquiry not found.', 404);

  // Fetch messages from all siblings so a broadcast owner sees the full thread
  let rowIds = [anchor._id];
  if (anchor.enq_code) {
    const siblings = await Enquiry.find({ enq_code: anchor.enq_code }).select('_id').lean();
    rowIds = siblings.map(s => s._id);
  }

  const messages = await EnquiryMessage.find({ enquiry_id: { $in: rowIds } })
    .populate('sender_user_id', 'name role')
    .sort({ created_at: 1 })
    .lean();

  return sendSuccess(res, {
    messages: messages.map(m => ({
      id:               m._id,
      message:          m.message,
      sender_side:      m.sender_side,
      seller_company_id: m.seller_company_id,
      sender:           m.sender_user_id ? { id: m.sender_user_id._id, name: m.sender_user_id.name, role: m.sender_user_id.role } : null,
      client_message_id: m.client_message_id || '',
      created_at:       m.created_at,
    })),
  }, 'Messages retrieved.');
}

/**
 * Admin / ERP operator: post a message into the enquiry thread.
 *
 * Sent as `sender_side: 'admin'` so the buyer and seller both see it. The
 * message is delivered to both parties via notifications, so neither side has
 * to open the operator's tool to know it was added.
 */
async function adminCreateMessage(req, res) {
  const message = String(req.body?.message || '').trim();
  const clientMessageId = String(req.body?.client_message_id || '').trim();
  if (!message || message.length > 2000) {
    return sendError(res, 'message is required and must not exceed 2000 characters.', 400);
  }

  const anchor = await Enquiry.findOne({
    _id: req.params.id,
    $or: [
      { company_id: req.user.company_id },
      { buyer_company_id: req.user.company_id },
      { broadcast_owner_company_id: req.user.company_id },
    ],
  }).lean();
  if (!anchor) return sendError(res, 'Enquiry not found.', 404);
  if (anchor.status === 'Cancelled') {
    return sendError(res, 'Messages cannot be sent on a cancelled enquiry.', 409);
  }

  // Idempotency on retries — if the operator's client retries with the same
  // `client_message_id`, return the existing message instead of duplicating it.
  if (clientMessageId) {
    const existing = await EnquiryMessage.findOne({ sender_user_id: req.user._id, client_message_id: clientMessageId }).lean();
    if (existing) return sendSuccess(res, {
      id: existing._id, message: existing.message, sender_side: existing.sender_side,
      client_message_id: existing.client_message_id, created_at: existing.created_at,
    }, 'Message already received.');
  }

  const created = await EnquiryMessage.create({
    enquiry_id:        anchor._id,
    buyer_company_id:  anchor.buyer_company_id || anchor.company_id,
    buyer_user_id:     anchor.buyer_user_id,
    seller_company_id: anchor.seller_company_id || anchor.company_id,
    sender_user_id:    req.user._id,
    sender_side:       'admin',
    message,
    client_message_id: clientMessageId,
  });

  // Notify both parties that an operator posted in the thread.
  const notifTargets = []
  if (anchor.buyer_company_id)  notifTargets.push({ company_id: anchor.buyer_company_id,  user_id: anchor.buyer_user_id })
  if (anchor.seller_company_id && String(anchor.seller_company_id) !== String(anchor.buyer_company_id)) {
    notifTargets.push({ company_id: anchor.seller_company_id })
  }
  await Promise.all(notifTargets.map(t =>
    Notification.create({
      company_id: t.company_id, user_id: t.user_id || null,
      type:       'enquiry_message',
      title:      `Operator note on ${anchor.enq_code || 'enquiry'}`,
      message:    `${req.company?.name || 'Operator'}: ${message.slice(0, 120)}`,
      reference_id: anchor._id,
    }).catch(() => null)
  ))

  return sendSuccess(res, {
    id: created._id, message: created.message, sender_side: created.sender_side,
    client_message_id: created.client_message_id, created_at: created.created_at,
  }, 'Message sent.', 201);
}

// ── Unified offer list (buyer + seller + operator) ──────────────────────────
// A broadcast is N sibling Enquiry rows sharing ONE `enq_code`; each recipient
// raises their own offer on THEIR row, so an offer's `enquiry_id` points at the
// recipient row — never at the anchor the sender is viewing. The old
// `sellerListOffers` scoped on `seller_company_id === me`, so the SENDER (a
// Retailer) was 403'd by `requireApprovedSeller` and never saw any offer, which
// hid the entire per-seller negotiation UI. This one endpoint serves every
// side:
//   • recipient/seller (same company on both sides of the row): their own offers
//   • buyer (broadcast owner or single-enquiry buyer): every offer across the
//     sibling rows whose buyer is this company
//   • operator (ERP/CRM): every offer across the sibling rows
async function listOffers(req, res) {
  const anchor = await Enquiry.findOne({
    _id: req.params.id,
    $or: [
      { company_id: req.user.company_id },
      { buyer_company_id: req.user.company_id },
      { broadcast_owner_company_id: req.user.company_id },
      ...(isOperator(req.user) ? [{}] : []),
    ],
  }).lean();
  if (!anchor) return sendError(res, 'Enquiry not found.', 404);

  // Recipient / seller row: return only the offers THEY raised on this row.
  if (
    String(anchor.seller_company_id) === String(req.user.company_id) &&
    String(anchor.company_id) === String(req.user.company_id)
  ) {
    const own = await EnquiryOffer.find({ enquiry_id: anchor._id, seller_company_id: req.user.company_id })
      .populate('seller_company_id', 'name city state')
      .sort({ created_at: -1 })
      .lean();
    return sendSuccess(res, { offers: own.map(shapeOffer) }, 'Offers retrieved.');
  }

  // Buyer / operator: gather every sibling row sharing this enq_code, then
  // return offers raised against them. Operators see all; the buyer only sees
  // offers where they are the buyer.
  const rows = await Enquiry.find({ enq_code: anchor.enq_code }).select('_id').lean();
  const rowIds = rows.map(r => r._id);
  const query = { enquiry_id: { $in: rowIds } };
  if (!isOperator(req.user)) query.buyer_company_id = req.user.company_id;
  const offers = await EnquiryOffer.find(query)
    .populate('seller_company_id', 'name city state')
    .sort({ created_at: -1 })
    .lean();
  return sendSuccess(res, { offers: offers.map(shapeOffer) }, 'Offers retrieved.');
}

// ── Unified message list (buyer + seller + operator) ────────────────────────
// Mirrors adminListMessages but extends it for the buyer: a buyer who raised a
// broadcast must see the WHOLE thread (every sibling row), not just the one
// row they happened to open. Recipients and operators keep seeing only the
// single row they anchored on, exactly as adminListMessages did.
async function listMessages(req, res) {
  const anchor = await Enquiry.findOne({
    _id: req.params.id,
    $or: [
      { company_id: req.user.company_id },
      { buyer_company_id: req.user.company_id },
      { broadcast_owner_company_id: req.user.company_id },
      ...(isOperator(req.user) ? [{}] : []),
    ],
  }).select('enq_code broadcast_owner_company_id').lean();
  if (!anchor) return sendError(res, 'Enquiry not found.', 404);

  let rowIds = [anchor._id];
  // Operators and broadcast owners see all siblings (full thread across all sellers)
  const isBroadcastOwner = anchor.broadcast_owner_company_id
    && String(anchor.broadcast_owner_company_id) === String(req.user.company_id);
  if (isBroadcastOwner || isOperator(req.user)) {
    const rows = await Enquiry.find({ enq_code: anchor.enq_code }).select('_id').lean();
    rowIds = rows.map(r => r._id);
  }

  const messages = await EnquiryMessage.find({ enquiry_id: { $in: rowIds } })
    .populate('sender_user_id', 'name role')
    .sort({ created_at: 1 })
    .lean();

  return sendSuccess(res, {
    messages: messages.map(m => ({
      id: m._id,
      message: m.message,
      sender_side: m.sender_side,
      seller_company_id: m.seller_company_id,
      sender: m.sender_user_id ? { id: m.sender_user_id._id, name: m.sender_user_id.name, role: m.sender_user_id.role } : null,
      client_message_id: m.client_message_id || '',
      created_at: m.created_at,
    })),
  }, 'Messages retrieved.');
}

// ── Unified message create (buyer + seller + operator) ──────────────────────
// Replaces the seller-only `sellerCreateMessage`. A buyer posts into a specific
// recipient's row (passed as `enquiry_id` from the client, since each seller's
// conversation lives on its own row); recipients post into their own row. The
// sender side is inferred from which side of the row this user is on.
async function createMessage(req, res) {
  const message = String(req.body?.message || '').trim();
  const clientMessageId = String(req.body?.client_message_id || '').trim();
  const targetId = req.body?.enquiry_id ? String(req.body.enquiry_id) : req.params.id;
  if (!message || message.length > 2000) {
    return sendError(res, 'message is required and must not exceed 2000 characters.', 400);
  }

  const row = await Enquiry.findOne({
    _id: targetId,
    $or: [
      { company_id: req.user.company_id },
      { buyer_company_id: req.user.company_id },
      { broadcast_owner_company_id: req.user.company_id },
      ...(isOperator(req.user) ? [{}] : []),
    ],
  }).lean();
  if (!row) return sendError(res, 'Enquiry not found.', 404);
  if (row.status === 'Cancelled') {
    return sendError(res, 'Messages cannot be sent on a cancelled enquiry.', 409);
  }

  // Idempotency on retries — same client_message_id returns the existing one.
  if (clientMessageId) {
    const existing = await EnquiryMessage.findOne({ sender_user_id: req.user._id, client_message_id: clientMessageId }).lean();
    if (existing) return sendSuccess(res, {
      id: existing._id, message: existing.message, sender_side: existing.sender_side,
      client_message_id: existing.client_message_id, created_at: existing.created_at,
    }, 'Message already received.');
  }

  // Infer which side is speaking so the other party renders the bubble right.
  let senderSide = 'admin';
  if (
    String(row.broadcast_owner_company_id) === String(req.user.company_id) ||
    String(row.buyer_company_id) === String(req.user.company_id)
  ) {
    senderSide = 'buyer';
  } else if (
    String(row.company_id) === String(req.user.company_id) &&
    String(row.seller_company_id) === String(req.user.company_id)
  ) {
    senderSide = 'seller';
  }

  const created = await EnquiryMessage.create({
    enquiry_id: row._id,
    buyer_company_id: row.buyer_company_id || row.company_id,
    buyer_user_id: row.buyer_user_id,
    seller_company_id: row.seller_company_id || row.company_id,
    sender_user_id: req.user._id,
    sender_side: senderSide,
    message,
    client_message_id: clientMessageId,
  });

  // Notify the counterparty (company-scoped; user ids are unknown on the row).
  const notifTargets = [];
  if (senderSide === 'buyer' && row.seller_company_id) {
    notifTargets.push({ company_id: row.seller_company_id });
  } else if (senderSide === 'seller' && row.buyer_company_id) {
    notifTargets.push({ company_id: row.buyer_company_id, user_id: row.buyer_user_id });
  } else if (senderSide === 'admin') {
    if (row.buyer_company_id) notifTargets.push({ company_id: row.buyer_company_id, user_id: row.buyer_user_id });
    if (row.seller_company_id && String(row.seller_company_id) !== String(row.buyer_company_id)) {
      notifTargets.push({ company_id: row.seller_company_id });
    }
  }
  await Promise.all(notifTargets.map(t =>
    Notification.create({
      company_id: t.company_id, user_id: t.user_id || null,
      type: 'enquiry_message', title: `New message on ${row.enq_code || 'enquiry'}`,
      message: `${req.company?.name || 'User'}: ${message.slice(0, 120)}`, reference_id: row._id,
    }).catch(() => null)
  ));

  return sendSuccess(res, {
    id: created._id, message: created.message, sender_side: created.sender_side,
    client_message_id: created.client_message_id, created_at: created.created_at,
  }, 'Message sent.', 201);
}

module.exports = { listEnquiries, enquiryStats, getEnquiry, enquiryReplies, createEnquiry, updateEnquiry, deleteEnquiry, adminListMessages, adminCreateMessage, listOffers, listMessages, createMessage, createReplyHistory, listReplyHistory };

// ── POST /enquiries/:id/reply-history  ────────────────────────────────────────
// Creates a NEW history record for every reply — nothing is ever overwritten.
// Also patches the parent enquiry row with the latest values so the list/card
// stays up-to-date, but the full timeline lives in EnquiryReplyHistory.
async function createReplyHistory(req, res) {
  const { offered_price, available_quantity, delivery_timeline, remarks, unit } = req.body;
  if (offered_price == null) return sendError(res, 'offered_price is required.', 400);

  // Locate the enquiry — accept any ownership shape
  const enquiry = await Enquiry.findOne({
    _id: req.params.id,
    $or: [
      { company_id: req.user.company_id },
      { broadcast_owner_company_id: req.user.company_id },
      { buyer_company_id: req.user.company_id },
      ...(isOperator(req.user) ? [{}] : []),
    ],
  }).lean();
  if (!enquiry) return sendError(res, 'Enquiry not found.', 404);

  // Determine which side the sender is on
  const me = String(req.user.company_id);
  let senderSide = 'admin';
  if (String(enquiry.broadcast_owner_company_id) === me || String(enquiry.buyer_company_id) === me) {
    senderSide = 'buyer';
  } else if (String(enquiry.company_id) === me) {
    senderSide = 'seller';
  }

  // Save history record
  const history = await EnquiryReplyHistory.create({
    enquiry_id:         enquiry._id,
    enq_code:           enquiry.enq_code || '',
    sender_company_id:  req.user.company_id,
    sender_user_id:     req.user._id,
    sender_name:        req.user.name || req.company?.name || '',
    sender_side:        senderSide,
    offered_price:      Number(offered_price),
    available_quantity: available_quantity != null ? Number(available_quantity) : null,
    unit:               unit || enquiry.unit || '',
    delivery_timeline:  String(delivery_timeline || '').trim(),
    remarks:            String(remarks || '').trim(),
  });

  // Also update the enquiry row with latest values + status
  await Enquiry.findOneAndUpdate(
    {
      _id: req.params.id,
      $or: [
        { company_id: req.user.company_id },
        { broadcast_owner_company_id: req.user.company_id },
        { buyer_company_id: req.user.company_id },
        ...(isOperator(req.user) ? [{}] : []),
      ],
    },
    {
      offered_price:      Number(offered_price),
      available_quantity: available_quantity != null ? Number(available_quantity) : undefined,
      delivery_timeline:  String(delivery_timeline || '').trim(),
      distributor_reply:  String(remarks || '').trim(),
      status:             'Replied',
    }
  );

  return sendSuccess(res, {
    id:                 history._id,
    offered_price:      history.offered_price,
    available_quantity: history.available_quantity,
    unit:               history.unit,
    delivery_timeline:  history.delivery_timeline,
    remarks:            history.remarks,
    sender_side:        history.sender_side,
    sender_name:        history.sender_name,
    created_at:         history.created_at,
  }, 'Reply saved.', 201);
}

// ── GET /enquiries/:id/reply-history  ─────────────────────────────────────────
// Returns all reply history records for an enquiry (or all siblings of a broadcast),
// newest first. Both CRM and retailer app use this to show the full reply timeline.
async function listReplyHistory(req, res) {
  const enquiry = await Enquiry.findOne({
    _id: req.params.id,
    $or: [
      { company_id: req.user.company_id },
      { broadcast_owner_company_id: req.user.company_id },
      { buyer_company_id: req.user.company_id },
      ...(isOperator(req.user) ? [{}] : []),
    ],
  }).select('_id enq_code').lean();
  if (!enquiry) return sendError(res, 'Enquiry not found.', 404);

  // For broadcasts, fetch history across all sibling rows
  const filter = enquiry.enq_code
    ? { enq_code: enquiry.enq_code }
    : { enquiry_id: enquiry._id };

  const history = await EnquiryReplyHistory.find(filter)
    .sort({ created_at: 1 })
    .lean();

  return sendSuccess(res, {
    total: history.length,
    replies: history.map(h => ({
      id:                 h._id,
      offered_price:      h.offered_price,
      available_quantity: h.available_quantity,
      unit:               h.unit,
      delivery_timeline:  h.delivery_timeline,
      remarks:            h.remarks,
      sender_side:        h.sender_side,
      sender_name:        h.sender_name,
      created_at:         h.created_at,
    })),
  }, 'Reply history retrieved.');
}
