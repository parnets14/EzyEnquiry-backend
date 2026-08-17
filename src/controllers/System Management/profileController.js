const { sendSuccess, sendError } = require('../../utils/helpers');
const User    = require('../../models/User Management/User');
const Company = require('../../models/Company Management/Company');
const bcrypt  = require('bcryptjs');

/** GET /api/profile */
async function getProfile(req, res) {
  const user = await User.findById(req.user._id).select('-password_hash').lean();
  if (!user) return sendError(res, 'User not found.', 404);

  let company = null;
  if (user.company_id) {
    company = await Company.findById(user.company_id)
      .select('name subscription_plan status biz_type city state')
      .lean();
  }

  sendSuccess(res, { ...user, company });
}

/** PUT /api/profile */
async function updateProfile(req, res) {
  const { name, mobile } = req.body;
  const update = {};
  if (name   !== undefined) update.name   = name;
  if (mobile !== undefined) update.mobile = mobile;

  const user = await User.findByIdAndUpdate(req.user._id, update, { new: true })
    .select('-password_hash')
    .lean();
  if (!user) return sendError(res, 'User not found.', 404);
  sendSuccess(res, user, 'Profile updated.');
}

/** POST /api/profile/change-password */
async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return sendError(res, 'Both fields are required.');
  if (newPassword.length < 8) return sendError(res, 'New password must be at least 8 characters.');

  const user = await User.findById(req.user._id).lean();
  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) return sendError(res, 'Current password is incorrect.', 400);

  const password_hash = await bcrypt.hash(newPassword, 12);
  await User.findByIdAndUpdate(req.user._id, { password_hash });
  sendSuccess(res, null, 'Password changed successfully.');
}

module.exports = { getProfile, updateProfile, changePassword };
