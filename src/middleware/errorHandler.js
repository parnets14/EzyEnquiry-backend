const { logger } = require('../utils/logger')

function errorHandler(err, req, res, next) {
  logger.error(`${err.status || 500} — ${err.message}`, {
    path:   req.path,
    method: req.method,
    stack:  err.stack,
  })

  // Postgres errors
  if (err.code === '23505') {
    return res.status(409).json({ success: false, message: 'Duplicate entry — record already exists.', field: err.detail })
  }
  if (err.code === '23503') {
    return res.status(400).json({ success: false, message: 'Referenced record does not exist.' })
  }
  if (err.code === '22P02') {
    return res.status(400).json({ success: false, message: 'Invalid data format.' })
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ success: false, message: 'Invalid token.' })
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ success: false, message: 'Token expired. Please login again.' })
  }

  const statusCode = err.status || err.statusCode || 500
  res.status(statusCode).json({
    success: false,
    message: statusCode === 500 ? 'Internal server error' : err.message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  })
}

module.exports = { errorHandler }
