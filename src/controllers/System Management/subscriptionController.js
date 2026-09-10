const { sendSuccess, sendError } = require('../../utils/helpers');
const Subscription = require('../../models/System Management/Subscription');
const Company      = require('../../models/Company Management/Company');

/** GET /api/subscriptions/current — active subscription for this company */
async function getCurrentSubscription(req, res) {
  const sub = await Subscription.findOne({
    company_id: req.user.company_id,
    status: 'Active',
  }).sort({ created_at: -1 }).lean();

  const company = await Company.findById(req.user.company_id).select('subscription_plan name').lean();

  sendSuccess(res, {
    subscription: sub || null,
    plan: company?.subscription_plan || 'Free',
    company_name: company?.name || '',
  });
}

/** GET /api/subscriptions */
async function listSubscriptions(req, res) {
  const subs = await Subscription.find({ company_id: req.user.company_id })
    .populate('company_id', 'name')
    .sort({ created_at: -1 })
    .lean();
  sendSuccess(res, subs);
}

/** POST /api/subscriptions */
async function createSubscription(req, res) {
  const { plan, starts_at, expires_at, amount_paid, payment_ref } = req.body;
  if (!plan || !starts_at || !expires_at)
    return sendError(res, 'plan, starts_at and expires_at are required.');

  const sub = await Subscription.create({
    company_id:  req.user.company_id,
    plan, starts_at, expires_at,
    amount_paid: amount_paid || 0,
    payment_ref: payment_ref || '',
    status:      'Active',
  });

  await Company.findByIdAndUpdate(req.user.company_id, { subscription_plan: plan });
  sendSuccess(res, sub.toObject(), 'Subscription created.', 201);
}

/** PATCH /api/subscriptions/:id/cancel */
async function cancelSubscription(req, res) {
  const sub = await Subscription.findOneAndUpdate(
    { _id: req.params.id, company_id: req.user.company_id },
    { status: 'Cancelled' },
    { new: true }
  ).lean();
  if (!sub) return sendError(res, 'Subscription not found.', 404);
  sendSuccess(res, sub, 'Subscription cancelled.');
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN (Super Admin) — cross-company subscription management + revenue
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/subscriptions/admin/all — every company's plan + current subscription */
async function listAllSubscriptions(req, res) {
  if (req.user.role !== 'Super Admin') return sendError(res, 'Access denied. Super Admin only.', 403)

  const companies = await Company.find({})
    .select('name company_code subscription_plan enquiry_limit enquiries_used plan_expires_at status')
    .sort({ created_at: -1 }).lean()

  // Latest subscription per company for amount/expiry display
  const subs = await Subscription.find({}).sort({ created_at: -1 }).lean()
  const latestByCompany = {}
  for (const s of subs) {
    const cid = String(s.company_id)
    if (!latestByCompany[cid]) latestByCompany[cid] = s
  }

  const rows = companies.map(c => {
    const sub = latestByCompany[String(c._id)] || null
    return {
      company_id:      c._id,
      company_name:    c.name,
      company_code:    c.company_code || '',
      status:          c.status,
      plan:            c.subscription_plan || 'Free',
      enquiry_limit:   c.enquiry_limit || 0,
      enquiries_used:  c.enquiries_used || 0,
      expires_at:      c.plan_expires_at || sub?.expires_at || null,
      last_amount:     sub?.amount_paid || 0,
    }
  })
  sendSuccess(res, { subscriptions: rows })
}

/** PATCH /api/subscriptions/company/:companyId — admin upgrade/downgrade/extend a plan */
async function setCompanyPlan(req, res) {
  if (req.user.role !== 'Super Admin') return sendError(res, 'Access denied. Super Admin only.', 403)

  const { plan, months, enquiry_limit, amount_paid } = req.body
  if (!plan) return sendError(res, 'plan is required.')

  const company = await Company.findById(req.params.companyId)
  if (!company) return sendError(res, 'Company not found.', 404)

  const now = new Date()
  const dur = parseInt(months) > 0 ? parseInt(months) : 1
  // Extend from current expiry if still valid, else from now.
  const base = company.plan_expires_at && company.plan_expires_at > now ? new Date(company.plan_expires_at) : now
  const expires = new Date(base); expires.setMonth(expires.getMonth() + dur)

  company.subscription_plan = plan
  company.plan_expires_at   = expires
  if (enquiry_limit !== undefined) company.enquiry_limit = parseInt(enquiry_limit) || 0
  await company.save()

  // Log a subscription record (revenue trail).
  const sub = await Subscription.create({
    company_id:  company._id,
    plan,
    starts_at:   now,
    expires_at:  expires,
    amount_paid: parseFloat(amount_paid) || 0,
    payment_ref: `ADMIN-${Date.now()}`,
    status:      'Active',
    enquiry_limit: company.enquiry_limit,
  })

  sendSuccess(res, { company: company.toObject(), subscription: sub.toObject() }, 'Plan updated.')
}

/** GET /api/subscriptions/admin/revenue — platform revenue rollup from subscriptions */
async function revenueSummary(req, res) {
  if (req.user.role !== 'Super Admin') return sendError(res, 'Access denied. Super Admin only.', 403)

  const [totalAgg, byPlan] = await Promise.all([
    Subscription.aggregate([{ $group: { _id: null, total: { $sum: '$amount_paid' }, count: { $sum: 1 } } }]),
    Subscription.aggregate([{ $group: { _id: '$plan', total: { $sum: '$amount_paid' }, count: { $sum: 1 } } }, { $sort: { total: -1 } }]),
  ])

  // Recent revenue entries (last 30) with company name.
  const recent = await Subscription.find({})
    .populate('company_id', 'name company_code')
    .sort({ created_at: -1 }).limit(30).lean()

  sendSuccess(res, {
    total_revenue: totalAgg[0]?.total || 0,
    total_subscriptions: totalAgg[0]?.count || 0,
    by_plan: byPlan.map(p => ({ plan: p._id || 'Unknown', total: p.total, count: p.count })),
    recent: recent.map(r => ({
      _id: r._id,
      company_name: r.company_id?.name || '—',
      plan: r.plan,
      amount_paid: r.amount_paid,
      payment_ref: r.payment_ref,
      created_at: r.created_at,
      expires_at: r.expires_at,
    })),
  })
}

module.exports = {
  getCurrentSubscription, listSubscriptions, createSubscription, cancelSubscription,
  listAllSubscriptions, setCompanyPlan, revenueSummary,
}
