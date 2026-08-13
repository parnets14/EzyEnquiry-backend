const mongoose = require('mongoose')

const notificationSchema = new mongoose.Schema({
  company_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  user_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'User',    default: null },
  type:         { type: String, required: true },
  title:        { type: String, required: true },
  message:      { type: String, required: true },
  reference_id: { type: mongoose.Schema.Types.ObjectId, default: null },
  is_read:      { type: Boolean, default: false },
}, { timestamps: { createdAt: 'created_at' } })

notificationSchema.index({ company_id: 1, is_read: 1 })
notificationSchema.index({ user_id: 1, is_read: 1 })

const NotificationModel = mongoose.model('Notification', notificationSchema)

class Notification {
  static async findAll(company_id, filters = {}) {
    const { is_read, limit = 30, offset = 0 } = filters
    const query = { company_id }
    if (is_read !== undefined) query.is_read = is_read !== 'false'
    return NotificationModel.find(query).sort({ created_at: -1 }).skip(offset).limit(limit).lean()
  }

  static async count(company_id, filters = {}) {
    const { is_read } = filters
    const query = { company_id }
    if (is_read !== undefined) query.is_read = is_read !== 'false'
    return NotificationModel.countDocuments(query)
  }

  static async getUnreadCount(company_id) {
    return NotificationModel.countDocuments({ company_id, is_read: false })
  }

  static async create(company_id, data) {
    const { type, title, message, reference_id, user_id } = data
    const notif = await NotificationModel.create({
      company_id,
      user_id:      user_id      || null,
      type, title, message,
      reference_id: reference_id || null,
    })
    return notif.toObject()
  }

  static async markRead(id, company_id) {
    return NotificationModel.findOneAndUpdate(
      { _id: id, company_id },
      { is_read: true },
      { new: true }
    ).lean()
  }

  static async markAllRead(company_id) {
    const result = await NotificationModel.updateMany(
      { company_id, is_read: false },
      { is_read: true }
    )
    return result.modifiedCount
  }

  static async delete(id, company_id) {
    const result = await NotificationModel.deleteOne({ _id: id, company_id })
    return result.deletedCount > 0
  }
}

module.exports = Notification
module.exports.NotificationModel = NotificationModel
