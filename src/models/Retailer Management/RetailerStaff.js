/**
 * RetailerStaff.js
 *
 * Staff members that belong to a Retailer's company.
 * A retailer owner adds staff from inside the Retailer App.
 * Staff log into the **Staff App** with OTP and only see
 * the modules their owner has granted them access to.
 *
 * Module keys map 1-to-1 with Staff App bottom tabs + stack screens:
 *   dashboard     → Dashboard tab (always visible, but listed for completeness)
 *   customers     → Customers tab + CustomerForm + CustomerDetail
 *   quotations    → Quotations stack screen + QuotationForm + QuotationDetail
 *   orders        → Orders tab + OrderDetail
 *   dispatches    → Dispatches stack screen + DispatchDetail
 *   finance       → Finance tab (FinanceScreen overview)
 *   invoices      → Invoices stack screen + InvoiceDetail
 *   collections   → Collections stack screen + CollectionDetail
 *   notifications → Notifications stack screen
 */
const mongoose = require('mongoose');

// ── Retailer App module keys — MUST match the modules offered by the
//    Retailer App "Add Staff" screen and getAvailableModules() controller.
//    Keep these three lists in sync:
//      1. this enum
//      2. retailerStaffController.getAvailableModules()
//      3. RetailerApp AddEditStaffScreen RETAILER_MODULES + StaffListScreen MODULE_LABELS
const RETAILER_APP_MODULES = [
  'dashboard',     // Dashboard summary
  'products',      // Browse product catalogue
  'enquiries',     // Create & track enquiries
  'orders',        // Place & track orders
  'invoices',      // View & pay invoices
  'customers',     // Manage customers
  'notifications', // In-app notifications
  'reports',       // Sales & order reports
  // ── ERP modules (added 2026-09-29, served by /api/retailer/erp/*) ──
  'sales',         // Sales entry, list & report
  'purchases',     // Purchase entry, list & suppliers
  'inventory',     // Inventory, warehouses, stock transfers
  'expenses',      // Expense entry, list & report
  'payments',      // Receivables & payables
  'accounts',      // Ledgers, cash book, bank book
  'profit_loss',   // Profit & loss dashboard
  'leads',         // CRM leads
  'dispatches',    // Dispatch tracking, status transitions & POD upload
  'documents',     // Document repository (typed uploads, list, delete)
];

// ── Salary breakdown sub-schema ───────────────────────────────
const salaryBreakdownSchema = new mongoose.Schema(
  {
    // Fixed monthly take-home
    fixed_salary: { type: Number, default: 0, min: 0 },

    // Incentive / bonus on top of fixed
    incentive_type: {
      type: String,
      enum: ['fixed', 'percentage', 'none'],
      default: 'none',
    },
    // Amount (rupees) when type=fixed; percentage when type=percentage
    incentive_value: { type: Number, default: 0, min: 0 },

    // Base amount the incentive % is applied to (For the Add Staff form's
    // "Amount × Percentage" pair, e.g. ₹10,000 at 10% = ₹11,000).
    incentive_base_amount: { type: Number, default: 0, min: 0 },

    // Incentive slabs — "when sales reach sales_amount, pay incentive_pct %".
    // The highest reached slab applies. Sorted ascending by sales_amount.
    incentive_slabs: {
      type: [{
        _id: false,
        sales_amount:  { type: Number, default: 0, min: 0 },
        incentive_pct: { type: Number, default: 0, min: 0 },
      }],
      default: [],
    },

    // Sales-based commission: % of each invoice/order value
    sales_percentage: { type: Number, default: 0, min: 0, max: 100 },

    // Whether this staff can apply discounts when creating orders/quotations
    discount_access: { type: Boolean, default: false },
    // Maximum discount % they are allowed to give
    max_discount_percent: { type: Number, default: 0, min: 0, max: 100 },

    // Per-product discount limits: the staff can discount each listed product
    // by at most `discount` %. Private to the staff profile.
    // mrp / retailPrice are snapshotted for display so the form doesn't need
    // to re-join the catalogue to show a price preview.
    product_discounts: {
      type: [{
        _id: false,
        id:          { type: String, default: '' },
        name:        { type: String, default: '' },
        code:        { type: String, default: '' },
        mrp:         { type: Number, default: 0, min: 0 },
        retailPrice: { type: Number, default: 0, min: 0 },
        discount:    { type: Number, default: 0, min: 0, max: 100 },
      }],
      default: [],
    },

    notes: { type: String, default: '' },
  },
  { _id: false }
);

// ── Main schema ───────────────────────────────────────────────
const retailerStaffSchema = new mongoose.Schema(
  {
    // The retailer's company this staff belongs to
    company_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },

    // Basic identity
    name:   { type: String, required: true, trim: true },
    mobile: { type: String, required: true, trim: true },   // 10-digit normalised
    email:  { type: String, default: '', lowercase: true, trim: true },

    // Optional role label (e.g. "Sales Executive", "Store Manager")
    designation: { type: String, default: '' },

    // Custom role access name created by the owner (e.g. "Cashier",
    // "Floor Manager"). This is a free-text label that sits alongside
    // `designation`; the granular permission control is still
    // `staff_app_access`. Kept separate so a preset designation and a
    // custom access name can both be recorded.
    role_access: { type: String, default: '' },

    // Modules this staff can see in the Retailer App.
    // Empty array = no restriction (all modules accessible).
    staff_app_access: {
      type: [{ type: String, enum: RETAILER_APP_MODULES }],
      default: [],
    },

    // Salary structure
    salary_breakdown: { type: salaryBreakdownSchema, default: () => ({}) },

    // Monthly sales target (₹) — drives the Staff App sales/incentive progress.
    sales_target: { type: Number, default: 0, min: 0 },

    // Organisation type — always 'retailer' for records in this collection.
    org_type: { type: String, enum: ['admin', 'wholesaler', 'retailer'], default: 'retailer' },

    // ── Assigned item allow-list (STRICT) ──────────────────────
    // The ONLY products this retailer staff member may see/sell.
    // If empty, the staff member sees NO products.
    assigned_products: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
      default: [],
    },

    is_active: { type: Boolean, default: true },

    // OTP login support — reuses the existing OTP utility
    last_login: { type: Date, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

// Unique mobile per company (a staff member's mobile is their login key)
retailerStaffSchema.index({ company_id: 1, mobile: 1 }, { unique: true });

const RetailerStaff = mongoose.model('RetailerStaff', retailerStaffSchema);

module.exports = RetailerStaff;
module.exports.RETAILER_APP_MODULES = RETAILER_APP_MODULES;
