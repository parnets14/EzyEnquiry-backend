/**
 * staffManagementRoutes.js
 *
 * Admin-side routes for managing staff members in the Staff App.
 * Mounted at /api/staff-management in server.js.
 *
 * Auth: authenticate + requireCompany applied by server.js.
 * Access: Company Owner and Manager can manage staff.
 *         Super Admin always passes (handled inside allow()).
 */
const express = require('express');
const router  = express.Router();
const ctrl    = require('../../controllers/Staff App Management/staffManagementController');
const { allow } = require('../../middleware/roleGuard');

// Who can manage staff members
const canManage = allow('Company Owner', 'Manager');

// ── Available module list (read by any authenticated user — used to render checkboxes)
router.get('/modules', ctrl.getAvailableModules);

// ── Staff CRUD ────────────────────────────────────────────────
router.get   ('/',                    canManage, ctrl.listStaff);
router.post  ('/',                    canManage, ctrl.addStaff);
router.get   ('/:id',                 canManage, ctrl.getStaff);
router.put   ('/:id',                 canManage, ctrl.updateStaff);
router.patch ('/:id/toggle-active',   canManage, ctrl.toggleStaffActive);
router.delete('/:id',                 canManage, ctrl.deleteStaff);

module.exports = router;
