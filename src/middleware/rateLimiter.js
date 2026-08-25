const rateLimit = require('express-rate-limit')

// Global rate limiter
const rateLimiter = rateLimit({
  windowMs:        parseInt(process.env.RATE_LIMIT_WINDOW_MINUTES || '15') * 60 * 1000,
  max:             parseInt(process.env.RATE_LIMIT_MAX_REQUESTS   || '100'),
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, message: 'Too many requests. Please try again later.' },
})

// Auth endpoint limiter — uses AUTH_RATE_LIMIT_MAX from .env
// Default 200 for dev, set to 10 in production .env
const authRateLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             parseInt(process.env.AUTH_RATE_LIMIT_MAX || '200'),
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, message: 'Too many auth attempts. Please try again in 15 minutes.' },
})

module.exports = { rateLimiter, authRateLimiter }
