const nodemailer = require('nodemailer')
const { logger } = require('./logger')

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || 'smtp.gmail.com',
  port:   parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

async function sendMail({ to, subject, html, text }) {
  if (!process.env.SMTP_USER) {
    logger.warn(`[Mailer] SMTP not configured. Would send to ${to}: ${subject}`)
    return { skipped: true }
  }
  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || 'EzyEnquiry <noreply@ezyenquiry.com>',
      to, subject, html, text,
    })
    logger.info(`[Mailer] Sent to ${to}: ${info.messageId}`)
    return info
  } catch (err) {
    logger.error(`[Mailer] Failed to send to ${to}:`, err.message)
    throw err
  }
}

async function sendOtpMail(email, otp, purpose = 'Login') {
  return sendMail({
    to: email,
    subject: `EzyEnquiry — Your ${purpose} OTP`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;border:1px solid #e2e8f0;border-radius:12px;">
        <h2 style="color:#FD5C02;margin-bottom:8px;">EzyEnquiry</h2>
        <p style="color:#374151;font-size:14px;">Your One-Time Password for <strong>${purpose}</strong>:</p>
        <div style="font-size:36px;font-weight:900;letter-spacing:10px;color:#01152D;margin:20px 0;text-align:center;">${otp}</div>
        <p style="color:#64748b;font-size:12px;">This OTP expires in ${process.env.OTP_EXPIRES_MINUTES || 10} minutes. Do not share it with anyone.</p>
      </div>`,
    text: `Your EzyEnquiry ${purpose} OTP is: ${otp}. Valid for ${process.env.OTP_EXPIRES_MINUTES || 10} minutes.`,
  })
}

module.exports = { sendMail, sendOtpMail }
