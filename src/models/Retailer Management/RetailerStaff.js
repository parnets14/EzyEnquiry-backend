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

// ── Staff App module keys — match Staff App navigator screen groups ────────────
const RETAILER_APP_MODULES = [
  'dashboard',    // Dashboard tab — always visible
  'customers',    // Customers tab + add/view customer
  'quotations',   // Quotations screen + create/view quotation
  'orders',       // Orders tab + order detail
  'dispatches',   // Dispatches screen + dispatch detail
  'finance',      // Finance tab overview
  'invoices',     // Invoices screen + invoice detail
  'collections',  // Collections screen + collection detail (record payment)
  'notifications',// Notifications screen
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

    // Sales-based commission: % of each invoice/order value
    sales_percentage: { type: Number, default: 0, min: 0, max: 100 },

    // Whether this staff can apply discounts when creating orders/quotations
    discount_access: { type: Boolean, default: false },
    // Maximum discount % they are allowed to give
    max_discount_percent: { type: Number, default: 0, min: 0, max: 100 },

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

    // Modules this staff can see in the Retailer App.
    // Empty array = no restriction (all modules accessible).
    staff_app_access: {
      type: [{ type: String, enum: RETAILER_APP_MODULES }],
      default: [],
    },

    // Salary structure
    salary_breakdown: { type: salaryBreakdownSchema, default: () => ({}) },

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
