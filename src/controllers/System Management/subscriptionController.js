const { sendSuccess, sendError } = require('../../utils/helpers');
const Subscription = require('../../models/System Management/Subscription');
const Company      = require('../../models/Company Management/Company');

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

module.exports = { listSubscriptions, createSubscription, cancelSubscription };
