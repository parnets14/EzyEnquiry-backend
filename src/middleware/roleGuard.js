/**
 * roleGuard.js
 * Granular role-based access control middleware for EzyEnquiry.
 *
 * Usage:
 *   const { allow, deny } = require('../middleware/roleGuard');
 *
 *   // Only these roles can access:
 *   router.post('/', allow('Super Admin', 'Company Owner', 'Manager'), ctrl.create);
 *
 *   // Everyone except these roles:
 *   router.delete('/:id', deny('Retailer', 'Wholesaler'), ctrl.delete);
 */

/**
 * Allow only the specified roles.
 * Super Admin always passes (platform-wide access).
 */
function allow(...roles) {
  const allowed = new Set(['Super Admin', ...roles]);
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    if (allowed.has(req.user.role)) return next();
    return res.status(403).json({
      success: false,
      message: `Access denied. Required role: ${roles.join(' or ')}.`,
    });
  };
}

/**
 * Block specific roles from an endpoint.
 * Everyone not in the deny list (including Super Admin) passes.
 */
function deny(...roles) {
  const blocked = new Set(roles);
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    if (blocked.has(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission for this action.',
      });
    }
    return next();
  };
}

/**
 * Role permission map — defines what each role can do per module.
 * Used by the RolePermissions frontend page to display the matrix.
 */
const ROLE_PERMISSIONS = {
  'Super Admin': {
    users: ['view', 'create', 'edit', 'delete'],
    companies: ['view', 'create', 'edit', 'delete', 'approve'],
    products: ['view', 'create', 'edit', 'delete'],
    inventory: ['view', 'create', 'edit', 'delete'],
    orders: ['view', 'create', 'edit', 'delete'],
    enquiries: ['view', 'create', 'edit', 'delete'],
    sales: ['view', 'create', 'edit', 'delete'],
    purchases: ['view', 'create', 'edit', 'delete'],
    expenses: ['view', 'create', 'edit', 'delete'],
    payments: ['view', 'create', 'edit', 'delete'],
    accounts: ['view'],
    profitLoss: ['view'],
    employees: ['view', 'create', 'edit', 'delete'],
    reports: ['view', 'export'],
    subscriptions: ['view', 'edit'],
  },
  'Company Owner': {
    users: ['view', 'create', 'edit', 'delete'],
    companies: ['view', 'edit'],
    products: ['view', 'create', 'edit', 'delete'],
    inventory: ['view', 'create', 'edit', 'delete'],
    orders: ['view', 'create', 'edit', 'delete'],
    enquiries: ['view', 'create', 'edit', 'delete'],
    sales: ['view', 'create', 'edit', 'delete'],
    purchases: ['view', 'create', 'edit', 'delete'],
    expenses: ['view', 'create', 'edit', 'delete'],
    payments: ['view', 'create', 'edit', 'delete'],
    accounts: ['view'],
    profitLoss: ['view'],
    employees: ['view', 'create', 'edit', 'delete'],
    reports: ['view', 'export'],
    subscriptions: ['view'],
  },
  'Manager': {
    orders: ['view', 'create', 'edit'],
    inventory: ['view', 'edit'],
    employees: ['view'],
    enquiries: ['view', 'edit'],
    customers: ['view', 'edit'],
    reports: ['view'],
  },
  'Accountant': {
    sales: ['view', 'create', 'edit'],
    purchases: ['view', 'create', 'edit'],
    expenses: ['view', 'create', 'edit'],
    payments: ['view', 'create', 'edit'],
    accounts: ['view'],
    profitLoss: ['view'],
    reports: ['view', 'export'],
  },
  'Sales Executive': {
    customers: ['view', 'create', 'edit'],
    leads: ['view', 'create', 'edit'],
    followups: ['view', 'create', 'edit'],
    orders: ['view', 'create'],
    enquiries: ['view', 'create'],
  },
  'Warehouse Staff': {
    inventory: ['view', 'create', 'edit'],
    orders: ['view'],
    dispatches: ['view', 'create', 'edit'],
    stockTransfers: ['view', 'create', 'edit'],
  },
  'Retailer': {
    products: ['view'],
    enquiries: ['view', 'create'],
    orders: ['view'],
  },
  'Wholesaler': {
    products: ['view', 'create', 'edit'],
    inventory: ['view', 'create', 'edit'],
    orders: ['view', 'create', 'edit'],
    enquiries: ['view', 'edit'],
  },
};

/** GET /api/role-permissions — returns the permission matrix for the frontend */
function getRolePermissions(req, res) {
  res.json({ success: true, data: ROLE_PERMISSIONS });
}

module.exports = { allow, deny, getRolePermissions, ROLE_PERMISSIONS };
