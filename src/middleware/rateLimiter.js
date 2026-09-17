// Rate limiting DISABLED — the limiters below are no-op pass-through middleware.
// This removes all "Too many requests" (HTTP 429) errors.
//
// To re-enable later, restore the express-rate-limit implementation.

// No-op middleware — simply calls next() so every request passes through.
const noopLimiter = (req, res, next) => next()

const rateLimiter     = noopLimiter
const authRateLimiter = noopLimiter

module.exports = { rateLimiter, authRateLimiter }
