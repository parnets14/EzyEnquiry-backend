const mongoose = require('mongoose')

function validateObjectIdParam(paramName) {
  return (req, res, next, value) => {
    if (!mongoose.Types.ObjectId.isValid(value)) {
      return res.status(400).json({ success: false, message: `Invalid ${paramName}.` })
    }
    next()
  }
}

module.exports = { validateObjectIdParam }
