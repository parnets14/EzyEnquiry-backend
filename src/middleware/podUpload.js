/**
 * podUpload.js
 *
 * Multer middleware for proof-of-delivery images (form field "pod").
 *
 * Extracted from `routes/Marketplace Management/dispatchRoutes.js` so the
 * retailer ERP surface (routes/Retailer Management/retailerErpRoutes.js) can
 * reuse the exact same storage dir, filename scheme, size cap and MIME filter
 * instead of re-declaring it. Behaviour is unchanged for the existing
 * POST /api/dispatches/upload-pod route.
 *
 * Resolves to <backend-root>/uploads/pod regardless of which route file mounts
 * it — the path is anchored to this file, not the caller.
 */
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

const POD_DIR = path.join(__dirname, '../../uploads/pod');
if (!fs.existsSync(POD_DIR)) fs.mkdirSync(POD_DIR, { recursive: true });

const podUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, POD_DIR),
    filename:    (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `pod-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Only image files are allowed for proof of delivery.'), ok);
  },
}).single('pod');

module.exports = { podUpload, POD_DIR };
