/**
 * Canonical action-level RBAC for EZYENQUIRY.
 *
 * Stored shape (schema v2):
 *   permissions: {
 *     products: { view: true, create: false, edit: false, delete: false },
 *     inventory: { view: true, stock_in: true, stock_out: false }
 *   }
 *
 * Legacy rows shaped as { moduleKey: boolean } remain supported. A legacy
 * `true` means every action in that module, preserving pre-v2 behaviour.
 */

const action = (key, label) => ({ key, label })
const crud = () => [action('view', 'View'), action('create', 'Add'), action('edit', 'Edit'), action('delete', 'Delete')]

const MODULE_CATALOG = [
  { key: 'dashboard', label: 'Dashboard', category: 'General', actions: [action('view', 'View')] },
  { key: 'profile', label: 'Profile', category: 'General', actions: [action('view', 'View'), action('edit', 'Edit Profile'), action('change_password', 'Change Password')] },
  { key: 'notifications', label: 'Notification System', category: 'General', actions: [action('view', 'View'), action('mark_read', 'Mark Read'), action('delete', 'Delete')] },

  { key: 'company', label: 'Company Registration', category: 'Company Management', actions: [action('view', 'View'), action('create', 'Add'), action('edit', 'Edit'), action('delete', 'Delete'), action('approve', 'Approve'), action('reject', 'Reject'), action('view_document', 'View Documents')] },
  { key: 'branch', label: 'Branch Management', category: 'Company Management', actions: crud() },
  { key: 'users', label: 'User & Role Management', category: 'Company Management', actions: [action('view', 'View'), action('create', 'Add User'), action('edit', 'Edit User'), action('delete', 'Delete User'), action('reset_password', 'Reset Password'), action('assign_role', 'Assign Role'), action('manage_permissions', 'Manage Permissions')] },

  { key: 'categories', label: 'Category Management', category: 'Product Management', actions: crud() },
  { key: 'brands', label: 'Brand Management', category: 'Product Management', actions: crud() },
  { key: 'products', label: 'Product Management', category: 'Product Management', actions: [action('view', 'View'), action('create', 'Add'), action('edit', 'Edit'), action('delete', 'Delete'), action('view_deleted', 'View Recycle Bin'), action('restore', 'Restore'), action('export', 'Download / Export')] },

  { key: 'suppliers', label: 'Supplier Management', category: 'Purchase & Inventory', actions: crud() },
  { key: 'purchases', label: 'Purchase Management', category: 'Purchase & Inventory', actions: [action('view', 'View'), action('create', 'Add'), action('edit', 'Edit'), action('delete', 'Delete'), action('approve', 'Approve'), action('stock_in', 'Receive Stock'), action('complete', 'Complete'), action('cancel', 'Cancel'), action('export', 'Export')] },
  { key: 'warehouses', label: 'Warehouse Management', category: 'Purchase & Inventory', actions: [action('view', 'View'), action('create', 'Add'), action('edit', 'Edit'), action('delete', 'Delete'), action('view_stock', 'View Stock')] },
  { key: 'inventory', label: 'Inventory Management', category: 'Purchase & Inventory', actions: [action('view', 'View'), action('stock_in', 'Stock In'), action('stock_out', 'Stock Out')] },
  { key: 'stock_transfer', label: 'Stock Transfer', category: 'Purchase & Inventory', actions: [action('view', 'View'), action('transfer', 'Create Transfer'), action('approve', 'Approve'), action('complete', 'Complete'), action('cancel', 'Cancel'), action('delete', 'Delete')] },

  { key: 'product_search', label: 'Product Search', category: 'Marketplace', actions: [action('view', 'View / Search')] },
  { key: 'enquiries', label: 'Enquiry Management', category: 'Marketplace', actions: [action('view', 'View'), action('create', 'Create'), action('edit', 'Edit'), action('delete', 'Delete'), action('reply', 'Reply'), action('offer', 'Send Offer'), action('close', 'Close / Cancel'), action('convert', 'Convert to Order')] },
  { key: 'orders', label: 'Order Management', category: 'Marketplace', actions: [action('view', 'View'), action('create', 'Create'), action('edit', 'Edit'), action('delete', 'Delete'), action('approve', 'Approve'), action('pick', 'Pick'), action('sort', 'Sort'), action('pack', 'Pack'), action('invoice', 'Generate Invoice'), action('dispatch', 'Dispatch'), action('deliver', 'Deliver'), action('cancel', 'Cancel')] },
  { key: 'dispatches', label: 'Dispatch Management', category: 'Marketplace', actions: [action('view', 'View'), action('dispatch', 'Create / In Transit'), action('edit', 'Edit'), action('deliver', 'Mark Delivered')] },

  { key: 'customers', label: 'Customer Management', category: 'CRM', actions: crud() },
  { key: 'leads', label: 'Lead Management', category: 'CRM', actions: [action('view', 'View'), action('create', 'Add'), action('edit', 'Edit'), action('delete', 'Delete'), action('convert', 'Convert to Customer')] },
  { key: 'followups', label: 'Follow-up Management', category: 'CRM', actions: [action('view', 'View'), action('create', 'Add'), action('edit', 'Edit'), action('delete', 'Delete'), action('complete', 'Mark Done')] },

  { key: 'quotations', label: 'Quotation Management', category: 'Finance', actions: [action('view', 'View'), action('create', 'Add'), action('edit', 'Edit'), action('delete', 'Delete'), action('send', 'Send'), action('approve', 'Accept'), action('convert', 'Convert'), action('cancel', 'Cancel'), action('export', 'Print / Export')] },
  { key: 'invoices', label: 'Invoice Management', category: 'Finance', actions: [action('view', 'View'), action('create', 'Add'), action('edit', 'Edit'), action('delete', 'Delete'), action('send', 'Send'), action('payment', 'Record Payment'), action('cancel', 'Cancel'), action('export', 'Print / Export')] },
  { key: 'sales', label: 'Sales Management', category: 'Finance', actions: [action('view', 'View'), action('create', 'Sales Entry'), action('export', 'Export')] },
  { key: 'expenses', label: 'Expense Management', category: 'Finance', actions: [action('view', 'View'), action('create', 'Add'), action('edit', 'Edit'), action('delete', 'Delete'), action('export', 'Export')] },
  { key: 'payments', label: 'Payment Management', category: 'Finance', actions: [action('view', 'View'), action('collect', 'Collect Receivable'), action('pay', 'Pay Supplier'), action('export', 'Export')] },
  { key: 'accounts', label: 'Accounts Module', category: 'Finance', actions: [action('view', 'View Ledgers'), action('export', 'Export')] },
  { key: 'profit_loss', label: 'Profit & Loss', category: 'Finance', actions: [action('view', 'View'), action('export', 'Export')] },

  { key: 'employee_master', label: 'Employee Master', category: 'HR', actions: crud() },
  { key: 'employees', label: 'Employee Management', category: 'HR', actions: crud() },
  { key: 'attendance', label: 'Attendance', category: 'HR', actions: [action('view', 'View'), action('mark', 'Mark Attendance'), action('edit', 'Edit Attendance')] },
  { key: 'salary', label: 'Salary', category: 'HR', actions: [action('view', 'View'), action('process', 'Process Salary'), action('pay', 'Mark Paid'), action('export', 'Download Payslip')] },

  { key: 'reports', label: 'Report Center', category: 'Reports', actions: [action('view', 'View'), action('export', 'PDF / Excel Export')] },

  { key: 'documents', label: 'Document Management', category: 'System', actions: [action('view', 'View'), action('upload', 'Upload'), action('download', 'Download'), action('delete', 'Delete')] },
  { key: 'subscriptions', label: 'Subscription System', category: 'System', actions: [action('view', 'View'), action('change_plan', 'Upgrade / Change Plan'), action('cancel', 'Cancel')] },
]

const MODULES = MODULE_CATALOG.reduce((acc, module) => {
  acc[module.key.toUpperCase()] = module.key
  return acc
}, {})
const ALL_MODULE_KEYS = MODULE_CATALOG.map(module => module.key)
const CATALOG_BY_KEY = Object.fromEntries(MODULE_CATALOG.map(module => [module.key, module]))

const ROLE_MODULES = {
  'Super Admin': '*',
  'Company Owner': '*',
  'Manager': ['dashboard', 'profile', 'notifications', 'categories', 'brands', 'products', 'suppliers', 'warehouses', 'inventory', 'stock_transfer', 'product_search', 'enquiries', 'orders', 'dispatches', 'customers', 'leads', 'followups', 'employees', 'attendance', 'reports'],
  'Accountant': ['dashboard', 'profile', 'notifications', 'suppliers', 'purchases', 'customers', 'quotations', 'invoices', 'sales', 'expenses', 'payments', 'accounts', 'profit_loss', 'reports', 'documents'],
  'Sales Executive': ['dashboard', 'profile', 'notifications', 'product_search', 'enquiries', 'orders', 'customers', 'leads', 'followups', 'quotations'],
  'Warehouse Staff': ['dashboard', 'profile', 'notifications', 'product_search', 'warehouses', 'inventory', 'stock_transfer', 'orders', 'dispatches'],
  'Retailer': ['dashboard', 'profile', 'notifications', 'product_search', 'enquiries', 'orders'],
  'Wholesaler': ['dashboard', 'profile', 'notifications', 'product_search', 'products', 'inventory', 'enquiries', 'orders'],
}

// Per-role action grants. '*' grants every catalogued action in that module.
const ROLE_ACTION_GRANTS = {
  'Super Admin': '*',
  'Company Owner': '*',
  'Manager': {
    dashboard: ['view'], profile: '*', notifications: '*',
    categories: ['view'], brands: ['view'], products: ['view', 'export'], suppliers: ['view'],
    warehouses: ['view', 'create', 'edit', 'view_stock'], inventory: '*', stock_transfer: '*', product_search: ['view'],
    enquiries: ['view', 'edit', 'reply', 'offer', 'close', 'convert'], orders: '*', dispatches: '*',
    customers: ['view', 'create', 'edit'], leads: ['view', 'create', 'edit', 'convert'], followups: '*',
    employees: ['view', 'edit'], attendance: '*', reports: '*',
  },
  'Accountant': {
    dashboard: ['view'], profile: '*', notifications: '*', suppliers: ['view'], customers: ['view'],
    purchases: ['view', 'create', 'edit', 'export'], quotations: ['view', 'create', 'edit', 'send', 'export'],
    invoices: '*', sales: '*', expenses: '*', payments: '*', accounts: '*', profit_loss: '*', reports: '*',
    documents: ['view', 'upload', 'download'],
  },
  'Sales Executive': {
    dashboard: ['view'], profile: '*', notifications: '*', product_search: ['view'],
    enquiries: ['view', 'create', 'edit', 'reply', 'offer', 'convert'], orders: ['view', 'create', 'edit', 'cancel'],
    customers: ['view', 'create', 'edit'], leads: ['view', 'create', 'edit', 'convert'],
    followups: ['view', 'create', 'edit', 'complete'], quotations: ['view', 'create', 'edit', 'send', 'export'],
  },
  'Warehouse Staff': {
    dashboard: ['view'], profile: '*', notifications: '*', product_search: ['view'], warehouses: ['view', 'view_stock'],
    inventory: '*', stock_transfer: '*', orders: ['view', 'pick', 'sort', 'pack', 'dispatch'], dispatches: '*',
  },
  'Retailer': {
    dashboard: ['view'], profile: '*', notifications: '*', product_search: ['view'],
    enquiries: ['view', 'create', 'reply', 'close'], orders: ['view', 'create', 'cancel'],
  },
  'Wholesaler': {
    dashboard: ['view'], profile: '*', notifications: '*', product_search: ['view'],
    products: ['view', 'create', 'edit', 'delete'], inventory: ['view', 'stock_in', 'stock_out'],
    enquiries: ['view', 'reply', 'offer'], orders: ['view', 'edit', 'approve', 'dispatch'],
  },
}

const ROLES = Object.keys(ROLE_MODULES)

function emptyPermissionMap(defaultValue = false) {
  const map = {}
  for (const module of MODULE_CATALOG) {
    map[module.key] = {}
    for (const item of module.actions) map[module.key][item.key] = defaultValue
  }
  return map
}

function defaultsForRole(role) {
  const result = emptyPermissionMap(false)
  const modules = ROLE_MODULES[role]
  const grants = ROLE_ACTION_GRANTS[role]
  if (!modules || !grants) return result

  for (const module of MODULE_CATALOG) {
    const moduleEnabled = modules === '*' || modules.includes(module.key)
    if (!moduleEnabled) continue
    const grantedActions = grants === '*' ? '*' : grants[module.key]
    for (const item of module.actions) {
      result[module.key][item.key] = grantedActions === '*' || Array.isArray(grantedActions) && grantedActions.includes(item.key)
    }
  }
  return result
}

/** Merge a legacy/v2 DB permission object over current SOP defaults. */
function effectivePermissions(role, savedPermissions) {
  const result = defaultsForRole(role)
  if (!savedPermissions || typeof savedPermissions !== 'object') return result

  for (const module of MODULE_CATALOG) {
    const savedModule = savedPermissions[module.key]
    if (typeof savedModule === 'boolean') {
      // Legacy compatibility: module=true previously granted the whole module.
      for (const item of module.actions) result[module.key][item.key] = savedModule
    } else if (savedModule && typeof savedModule === 'object') {
      for (const item of module.actions) {
        if (typeof savedModule[item.key] === 'boolean') result[module.key][item.key] = savedModule[item.key]
      }
    }
  }
  return result
}

function canAccess(role, moduleKey, actionKey = 'view') {
  return !!defaultsForRole(role)?.[moduleKey]?.[actionKey]
}

function transitionAction(moduleKey, req) {
  const path = req.path || '/'
  const method = req.method
  const status = String(req.body?.status || '').toLowerCase()

  if (moduleKey === 'company') {
    if (/\/documents\//.test(path) && method === 'GET') return 'view_document'
    if (/\/approve$/.test(path)) return 'approve'
    if (/\/reject$/.test(path)) return 'reject'
    if (/\/docs$/.test(path)) return 'approve'
  }
  if (moduleKey === 'users') {
    if (/reset-password$/.test(path)) return 'reset_password'
    if (method === 'PUT' && req.body?.role !== undefined) return 'assign_role'
  }
  if (moduleKey === 'products') {
    if (/recycle-bin/.test(path) && method === 'GET') return 'view_deleted'
    if (/\/restore$/.test(path)) return 'restore'
  }
  if (moduleKey === 'warehouses' && /\/stock$/.test(path)) return 'view_stock'
  if (moduleKey === 'inventory' && /\/adjust$/.test(path)) return Number(req.body?.adjustment || 0) >= 0 ? 'stock_in' : 'stock_out'
  if (moduleKey === 'stock_transfer') {
    if (method === 'POST') return 'transfer'
    if (/\/status$/.test(path)) return status.includes('complete') ? 'complete' : status.includes('cancel') ? 'cancel' : 'approve'
  }
  if (moduleKey === 'purchases' && /\/status$/.test(path)) {
    if (status === 'approved') return 'approve'
    if (status === 'received') return 'stock_in'
    if (status === 'completed') return 'complete'
    if (status === 'cancelled') return 'cancel'
  }
  if (moduleKey === 'enquiries') {
    if (/\/offers/.test(path)) return method === 'GET' ? 'view' : 'offer'
    if (/\/messages/.test(path)) return method === 'GET' ? 'view' : 'reply'
    if (method === 'PATCH') return ['cancelled', 'closed'].includes(status) ? 'close' : ['replied', 'negotiation', 'viewed'].includes(status) ? 'reply' : 'edit'
  }
  if (moduleKey === 'orders' && /\/status$/.test(path)) {
    if (status.includes('approv') || status.includes('accept')) return 'approve'
    if (status.includes('pick')) return 'pick'
    if (status.includes('sort')) return 'sort'
    if (status.includes('pack') || status.includes('ready')) return 'pack'
    if (status.includes('invoice')) return 'invoice'
    if (status.includes('dispatch')) return 'dispatch'
    if (status.includes('deliver')) return 'deliver'
    if (status.includes('cancel')) return 'cancel'
    return 'edit'
  }
  if (moduleKey === 'dispatches') {
    if (method === 'POST' || /intransit$/.test(path)) return 'dispatch'
    if (/deliver$/.test(path)) return 'deliver'
  }
  if (moduleKey === 'leads' && /convert$/.test(path)) return 'convert'
  if (moduleKey === 'followups' && method === 'PUT' && String(req.body?.status).toLowerCase() === 'done') return 'complete'
  if (moduleKey === 'quotations' && /\/status$/.test(path)) {
    if (status === 'sent') return 'send'
    if (status === 'accepted') return 'approve'
    if (status === 'converted') return 'convert'
    if (['cancelled', 'expired', 'rejected'].includes(status)) return 'cancel'
  }
  if (moduleKey === 'invoices') {
    if (/\/payment$/.test(path)) return 'payment'
    if (/\/status$/.test(path)) return ['cancelled', 'void'].includes(status) ? 'cancel' : status === 'sent' ? 'send' : status.includes('paid') ? 'payment' : 'edit'
  }
  if (moduleKey === 'payments') {
    if (/\/collect$/.test(path)) return 'collect'
    if (/\/pay$/.test(path)) return 'pay'
  }
  if (moduleKey === 'attendance' && /\/mark$/.test(path)) return 'mark'
  if (moduleKey === 'salary') {
    if (method === 'POST') return 'process'
    if (/\/pay$/.test(path)) return 'pay'
  }
  if (moduleKey === 'notifications' && method === 'PATCH') return 'mark_read'
  if (moduleKey === 'documents' && method === 'POST') return 'upload'
  if (moduleKey === 'subscriptions') {
    if (method === 'POST') return 'change_plan'
    if (/\/cancel$/.test(path)) return 'cancel'
  }

  if (method === 'GET' || method === 'HEAD') return 'view'
  if (method === 'POST') return 'create'
  if (method === 'PUT' || method === 'PATCH') return 'edit'
  if (method === 'DELETE') return 'delete'
  return 'view'
}

function moduleAccess(moduleKey) {
  return async (req, res, next) => {
    const role = req.user?.role
    if (role === 'Super Admin') return next()
    if (!role) return deny(res, moduleKey, 'view')

    const requestedAction = transitionAction(moduleKey, req)
    try {
      const RolePermission = require('../models/System Management/RolePermission')
      const companyId = req.user?.company_id
      const doc = companyId ? await RolePermission.findOne({ company_id: companyId, role }).lean() : null
      const permissions = effectivePermissions(role, doc?.permissions)
      if (permissions[moduleKey]?.[requestedAction] === true) return next()
      return deny(res, moduleKey, requestedAction)
    } catch (error) {
      // Authorization must fail closed when its persistence lookup fails.
      return deny(res, moduleKey, requestedAction)
    }
  }
}

function deny(res, moduleKey, actionKey) {
  return res.status(403).json({
    success: false,
    message: `Access denied. You cannot ${actionKey.replaceAll('_', ' ')} in ${moduleKey.replaceAll('_', ' ')}.`,
    permission: `${moduleKey}.${actionKey}`,
  })
}

module.exports = {
  MODULES,
  MODULE_CATALOG,
  ALL_MODULE_KEYS,
  CATALOG_BY_KEY,
  ROLES,
  ROLE_MODULES,
  ROLE_ACTION_GRANTS,
  defaultsForRole,
  effectivePermissions,
  canAccess,
  transitionAction,
  moduleAccess,
}
