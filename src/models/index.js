const Company       = require('./Company Management/Company')
const Branch        = require('./Company Management/Branch')
const User          = require('./User Management/User')
const Category      = require('./Product Management/Category')
const Brand         = require('./Product Management/Brand')
const Product       = require('./Product Management/Product')
const Supplier      = require('./Purchase & Inventory Management/Supplier')
const Purchase      = require('./Purchase & Inventory Management/Purchase')
const PurchaseRequisition = require('./Purchase & Inventory Management/PurchaseRequisition')
const PurchaseOrder = require('./Purchase & Inventory Management/PurchaseOrder')
const GRN = require('./Purchase & Inventory Management/GRN')
const QualityInspection = require('./Purchase & Inventory Management/QualityInspection')
const PurchaseReturn = require('./Purchase & Inventory Management/PurchaseReturn')
const Warehouse     = require('./Purchase & Inventory Management/Warehouse')
const Inventory     = require('./Purchase & Inventory Management/Inventory')
const OpeningStock = require('./Purchase & Inventory Management/OpeningStock')
const UnitConversion = require('./Purchase & Inventory Management/UnitConversion')
const RackBin = require('./Purchase & Inventory Management/RackBin')
const Batch = require('./Purchase & Inventory Management/Batch')
const DamageRecord = require('./Purchase & Inventory Management/DamageRecord')
const StockAdjustment = require('./Purchase & Inventory Management/StockAdjustment')
const Shade = require('./Purchase & Inventory Management/Shade')
const StockTransfer = require('./Purchase & Inventory Management/StockTransfer')
const StockMovement = require('./Purchase & Inventory Management/StockMovement')
const Enquiry       = require('./Marketplace Management/Enquiry')
const EnquiryOffer  = require('./Marketplace Management/EnquiryOffer')
const EnquiryMessage= require('./Marketplace Management/EnquiryMessage')
const Order         = require('./Marketplace Management/Order')
const Dispatch      = require('./Marketplace Management/Dispatch')
const Customer      = require('./CRM Management/Customer')
const Lead          = require('./CRM Management/Lead')
const Followup      = require('./CRM Management/Followup')
const Sale          = require('./Finance Management/Sale')
const Expense       = require('./Finance Management/Expense')
const Invoice       = require('./Finance Management/Invoice')
const Receivable    = require('./Finance Management/Receivable')
const Payable       = require('./Finance Management/Payable')
const Transaction   = require('./Finance Management/Transaction')
const Quotation     = require('./Finance Management/Quotation')
const Department    = require('./HR Management/Department')
const Designation   = require('./HR Management/Designation')
const Employee      = require('./HR Management/Employee')
const Attendance    = require('./HR Management/Attendance')
const SalaryRecord  = require('./HR Management/SalaryRecord')
const RetailerStaff = require('./Retailer Management/RetailerStaff')
const Notification  = require('./System Management/Notification')
const Counter       = require('./System Management/Counter')

module.exports = {
  Company,
  Branch,
  User,
  Category,
  Brand,
  Product,
  Supplier,
  Purchase,
  PurchaseRequisition,
  PurchaseOrder,
  GRN,
  QualityInspection,
  PurchaseReturn,
  Warehouse,
  Inventory,
  OpeningStock,
  UnitConversion,
  RackBin,
  Batch,
  DamageRecord,
  StockAdjustment,
  Shade,
  StockTransfer,
  StockMovement,
  Enquiry,
  EnquiryOffer,
  EnquiryMessage,
  Order,
  Dispatch,
  Customer,
  Lead,
  Followup,
  Sale,
  Expense,
  Invoice,
  Receivable,
  Payable,
  Transaction,
  Quotation,
  Department,
  Designation,
  Employee,
  Attendance,
  SalaryRecord,
  RetailerStaff,
  Notification,
  Counter,
}
