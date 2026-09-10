const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const ctrl    = require('../../controllers/Marketplace Management/dispatchController');

// Proof-of-delivery image upload (field: "pod")
const POD_DIR = path.join(__dirname, '../../../uploads/pod');
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

router.get   ('/',                ctrl.listDispatches);
router.post  ('/upload-pod',      podUpload, ctrl.uploadPod);
router.get   ('/:id',             ctrl.getDispatch);
router.post  ('/',                ctrl.createDispatch);
router.patch ('/:id/intransit',   ctrl.markInTransit);
router.patch ('/:id/deliver',     ctrl.markDelivered);
router.put   ('/:id',             ctrl.updateDispatch);

module.exports = router;
