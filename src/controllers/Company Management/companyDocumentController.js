/**
 * companyDocumentController.js
 * Secure access to a company's private KYC documents (GST, PAN, Address, Trade).
 *
 * KYC files live under /uploads/kyc and are NOT served publicly. Instead:
 *   1. An authenticated admin calls GET /api/companies/:id/documents
 *      → we return short-lived SIGNED URLs (a JWT token embedded in the URL).
 *   2. The browser <img>/link then hits GET /api/companies/documents/view?token=...
 *      → we verify the token and stream the file. The token itself is the auth,
 *        so no Authorization header is needed on the image request, and it expires.
 */

const path = require('path')
const fs   = require('fs')
const jwt  = require('jsonwebtoken')
const { sendSuccess, sendError } = require('../../utils/helpers')
const Company = require('../../models/Company Management/Company')

// Map the public doc "type" to the Company model URL field.
const DOC_FIELD = {
  gst:     'doc_gst_url',
  pan:     'doc_pan_url',
  address: 'doc_reg_url',
  biz:     'doc_trade_url',
}

const KYC_DIR    = path.join(__dirname, '..', '..', '..', 'uploads', 'kyc')
const TOKEN_TTL  = '10m' // signed URLs are valid for 10 minutes

/**
 * GET /api/companies/:id/documents
 * Auth required (Super Admin / Company Owner via route guard).
 * Returns signed, expiring URLs for each uploaded KYC document.
 */
async function getCompanyDocuments(req, res) {
  const company = await Company.findById(req.params.id)
    .select('doc_gst_url doc_pan_url doc_reg_url doc_trade_url docs_gst docs_pan docs_address docs_biz')
    .lean()
  if (!company) return sendError(res, 'Company not found.', 404)

  const documents = {}
  for (const [type, field] of Object.entries(DOC_FIELD)) {
    const url = company[field]
    if (!url) { documents[type] = null; continue }

    // Sign a token scoped to this company + doc type (not the raw path).
    const token = jwt.sign(
      { scope: 'company_kyc', company_id: String(company._id), type },
      process.env.JWT_SECRET,
      { expiresIn: TOKEN_TTL }
    )
    documents[type] = `/api/companies/documents/view?token=${encodeURIComponent(token)}`
  }

  sendSuccess(res, { documents })
}

/**
 * GET /api/companies/documents/view?token=...
 * No auth middleware — the signed token IS the authorization. Streams the file.
 */
async function viewCompanyDocument(req, res) {
  const { token } = req.query
  if (!token) return sendError(res, 'Missing token.', 400)

  let payload
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET)
  } catch {
    return sendError(res, 'Invalid or expired document link.', 401)
  }

  if (payload.scope !== 'company_kyc' || !DOC_FIELD[payload.type]) {
    return sendError(res, 'Invalid document token.', 401)
  }

  const company = await Company.findById(payload.company_id)
    .select(DOC_FIELD[payload.type])
    .lean()
  if (!company) return sendError(res, 'Company not found.', 404)

  const url = company[DOC_FIELD[payload.type]]
  if (!url) return sendError(res, 'Document not found.', 404)

  // Resolve the file safely inside KYC_DIR (prevent path traversal).
  const fileName = path.basename(url)            // strip any directory parts
  const filePath = path.join(KYC_DIR, fileName)
  if (!filePath.startsWith(KYC_DIR) || !fs.existsSync(filePath)) {
    return sendError(res, 'File not found.', 404)
  }

  return res.sendFile(filePath)
}

module.exports = { getCompanyDocuments, viewCompanyDocument }
