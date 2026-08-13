const rateLimit = require('express-rate-limit')

const rateLimiter = rateLimit({
  windowMs:    (parseInt(process.env.RATE_LIMIT_WINDOW_MINUTES || '15')) * 60 * 1000,
  max:          parseInt(process.env.RATE_LIMIT_MAX_REQUESTS   || '100'),
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, message: 'Too many requests. Please try again later.' },
})

// Stricter limiter for auth endpoints
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many login attempts. Please try again in 15 minutes.' },
})

module.exports = { rateLimiter, authRateLimiter }
