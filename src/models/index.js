const Company       = require('./Company Management/Company')
const Branch        = require('./Company Management/Branch')
const User          = require('./User Management/User')
const Category      = require('./Product Management/Category')
const Brand         = require('./Product Management/Brand')
const Product       = require('./Product Management/Product')
const Supplier      = require('./Purchase & Inventory Management/Supplier')
const Purchase      = require('./Purchase & Inventory Management/Purchase')
const Warehouse     = require('./Purchase & Inventory Management/Warehouse')
const Inventory     = require('./Purchase & Inventory Management/Inventory')
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
const Employee      = require('./HR Management/Employee')
const Attendance    = require('./HR Management/Attendance')
const SalaryRecord  = require('./HR Management/SalaryRecord')
const Notification  = require('./System Management/Notification')

module.exports = {
  Company,
  Branch,
  User,
  Category,
  Brand,
  Product,
  Supplier,
  Purchase,
  Warehouse,
  Inventory,
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
  Employee,
  Attendance,
  SalaryRecord,
  Notification,
}
