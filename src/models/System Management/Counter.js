const mongoose = require('mongoose')

/**
 * Atomic sequence counter.
 * One document per sequence key (e.g. 'company'). The `seq` value is
 * incremented atomically with findOneAndUpdate($inc) so concurrent
 * registrations from web and mobile never receive the same number.
 */
const counterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // sequence key, e.g. 'company'
    seq: { type: Number, default: 0 },
  },
  { versionKey: false }
)

module.exports = mongoose.model('Counter', counterSchema)
