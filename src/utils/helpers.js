/**
 * Send a success JSON response
 */
function sendSuccess(res, data, message = 'Success', statusCode = 200) {
  return res.status(statusCode).json({ success: true, message, data })
}

/**
 * Send an error JSON response
 */
function sendError(res, message = 'Something went wrong', statusCode = 400, errors = null) {
  const body = { success: false, message }
  if (errors) body.errors = errors
  return res.status(statusCode).json(body)
}

/**
 * Build a simple pagination object
 */
function paginate(total, page, limit) {
  const totalPages = Math.ceil(total / limit)
  return {
    total,
    page,
    limit,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  }
}

/**
 * Format Indian date string: "05 Aug 2026"
 */
function formatDateIN(date) {
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

module.exports = { sendSuccess, sendError, paginate, formatDateIN }
