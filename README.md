# EzyEnquiry Backend API

**Complete Backend for Tiles Industry ERP + B2B Marketplace**

Node.js + Express + PostgreSQL REST API supporting all 28 modules from the 45-day development plan.

---

## 📋 Features

### ✅ Module Coverage (28/28)

1. **Authentication & Authorization**
   - Email + Password Login
   - OTP-based Login (Email/Mobile)
   - JWT Token Authentication
   - Role-Based Access Control (8 roles)
   - Refresh Tokens

2. **Company Management**
   - Company Registration
   - Admin Approval Workflow
   - Subscription Plans (Free/Silver/Gold/Platinum)
   - Document Upload & Verification

3. **User Management**
   - Multi-user Support
   - Role Assignment
   - Password Management
   - Activity Tracking

4. **Product Management**
   - Categories & Subcategories
   - Brands
   - Products (Code, Name, Pricing Tiers, Images)
   - Multi-attribute (Size, Finish, Material, Color)

5. **Inventory Management**
   - Multi-warehouse Support
   - Stock In/Out Tracking
   - Low Stock Alerts
   - Stock Transfer between Warehouses
   - Manual Stock Adjustment

6. **Marketplace**
   - Product Search with Filters
   - Enquiry Management (Retailer → Wholesaler)
   - Negotiation Flow
   - Enquiry Status Pipeline

7. **Order Management**
   - Convert Enquiry → Order
   - Order Status Flow (New → Accepted → Processing → Ready → Dispatched → Delivered)
   - GST Calculation
   - Purchase Cost Tracking

8. **Dispatch Management**
   - Vehicle & Driver Details
   - LR Number & Transport Name
   - Auto Inventory Deduction
   - Delivery Tracking

9. **CRM**
   - Customer Management
   - Lead Management (Sources: Website, WhatsApp, FB, Instagram, Google Ads, Referral)
   - Lead Status Pipeline
   - Follow-up Management with Reminders
   - Lead → Customer Conversion

10. **Purchase Management**
    - Supplier Management
    - Purchase Entry
    - Auto Stock-In
    - Purchase Reports

11. **Sales Management**
    - Auto Sales Entry (on Delivery)
    - Payment Status Tracking
    - Sales Reports

12. **Expense Management**
    - Expense Categories
    - Payment Modes
    - Date-wise Expense Reports

13. **Payment Management**
    - Payments Receivable (Customers)
    - Payments Payable (Suppliers)
    - Payment Collection & Recording
    - Transaction History

14. **Profit & Loss**
    - Auto-calculation: Sales - Purchase - Expenses - Salary
    - Monthly/Yearly Reports
    - Expense Breakdown
    - Revenue vs Profit Trends

15. **Accounts / Ledgers**
    - Customer Ledger
    - Supplier Ledger
    - Running Balance Calculation

16. **HR Management**
    - Employee Management
    - Department & Designation
    - Attendance (Check-in/Check-out)
    - Salary Records

17. **Reports & Analytics**
    - Dashboard Stats (Revenue, Orders, Customers, Outstanding)
    - Top Products by Sales
    - Top Customers by Revenue
    - Low Stock Alerts

18. **Notifications**
    - Real-time Notifications for Enquiry/Order/Payment/Dispatch/Stock
    - Mark Read/Unread
    - Notification History

19. **Document Management**
    - Upload Documents (GST, PAN, Address Proof, etc.)
    - Link Documents to Entities (Company, Order, Product, etc.)

20. **Subscription System**
    - Plan Management (Free/Silver/Gold/Platinum)
    - Subscription History

---

## 🚀 Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js 4.19
- **Database**: PostgreSQL 15+
- **Authentication**: JWT + bcrypt
- **File Upload**: Multer
- **Logging**: Winston
- **Email**: Nodemailer
- **Security**: Helmet, CORS, Rate Limiting

---

## 📦 Installation

### Prerequisites

- Node.js 18+ and npm
- PostgreSQL 15+
- SMTP credentials (Gmail, SendGrid, etc.) for OTP emails

### Steps

1. **Clone & Install**
   ```bash
   cd Ezyenquiry-backend
   npm install
   ```

2. **Database Setup**
   ```bash
   # Create database
   psql -U postgres
   CREATE DATABASE ezyenquiry;
   \q
   ```

3. **Environment Variables**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

4. **Run Migrations**
   ```bash
   npm run migrate
   ```

5. **Seed Demo Data**
   ```bash
   npm run seed
   ```

6. **Start Server**
   ```bash
   npm run dev    # Development (with nodemon)
   npm start      # Production
   ```

Server runs on `http://localhost:5000`

---

## 🔐 Environment Variables

```env
# Server
PORT=5000
NODE_ENV=development

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ezyenquiry
DB_USER=postgres
DB_PASSWORD=your_password

# JWT
JWT_SECRET=your_super_secret_jwt_key_min_32_chars
JWT_EXPIRES_IN=7d

# OTP
OTP_EXPIRES_MINUTES=10
OTP_LENGTH=6

# Email (SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password

# Frontend URL
FRONTEND_URL=http://localhost:5173
```

---

## 🛣️ API Endpoints

### Authentication
```
POST   /api/auth/login             - Email + Password login
POST   /api/auth/send-otp          - Send OTP to email/mobile
POST   /api/auth/verify-otp        - Verify OTP & login
GET    /api/auth/me                - Get logged-in user info
POST   /api/auth/change-password   - Change password
POST   /api/auth/logout            - Logout
```

### Companies
```
GET    /api/companies              - List all companies (Admin)
GET    /api/companies/:id          - Get company details
POST   /api/companies              - Register new company
PATCH  /api/companies/:id/approve  - Approve company (Super Admin)
PATCH  /api/companies/:id/reject   - Reject company (Super Admin)
PUT    /api/companies/:id          - Update company
DELETE /api/companies/:id          - Delete company
PATCH  /api/companies/:id/docs     - Update document flags
```

### Users
```
GET    /api/users                  - List users
GET    /api/users/:id              - Get user details
POST   /api/users                  - Create user
PUT    /api/users/:id              - Update user
DELETE /api/users/:id              - Delete user
PATCH  /api/users/:id/reset-password - Reset user password (Admin)
```

### Products
```
GET    /api/categories             - List categories
POST   /api/categories             - Create category
PUT    /api/categories/:id         - Update category
DELETE /api/categories/:id         - Delete category

GET    /api/brands                 - List brands
POST   /api/brands                 - Create brand
PUT    /api/brands/:id             - Update brand
DELETE /api/brands/:id             - Delete brand

GET    /api/products               - List products (with filters)
GET    /api/products/search        - Marketplace product search
GET    /api/products/:id           - Get product details
POST   /api/products               - Create product
PUT    /api/products/:id           - Update product
DELETE /api/products/:id           - Delete product
```

### Inventory
```
GET    /api/inventory              - List inventory (with filters)
PATCH  /api/inventory/adjust       - Manual stock adjustment
GET    /api/inventory/warehouses   - List warehouses
POST   /api/inventory/warehouses   - Create warehouse
PUT    /api/inventory/warehouses/:id - Update warehouse
DELETE /api/inventory/warehouses/:id - Delete warehouse
POST   /api/inventory/transfers    - Create stock transfer
GET    /api/inventory/transfers    - List stock transfers
```

### Enquiries
```
GET    /api/enquiries              - List enquiries (with filters)
GET    /api/enquiries/stats        - Enquiry stats by status
GET    /api/enquiries/:id          - Get enquiry details
POST   /api/enquiries              - Create enquiry
PATCH  /api/enquiries/:id          - Update enquiry (reply, negotiation, status)
DELETE /api/enquiries/:id          - Delete enquiry
```

### Orders
```
GET    /api/orders                 - List orders (with filters)
GET    /api/orders/:id             - Get order details
POST   /api/orders                 - Create order
PATCH  /api/orders/:id/status      - Update order status
PUT    /api/orders/:id             - Update order
DELETE /api/orders/:id             - Delete order
```

### Dispatches
```
GET    /api/dispatches             - List dispatches
GET    /api/dispatches/:id         - Get dispatch details
POST   /api/dispatches             - Create dispatch (auto deduct stock)
PATCH  /api/dispatches/:id/deliver - Mark as delivered (auto sales entry)
PUT    /api/dispatches/:id         - Update dispatch
```

### CRM
```
GET    /api/customers              - List customers
GET    /api/customers/:id          - Get customer (with order history)
POST   /api/customers              - Create customer
PUT    /api/customers/:id          - Update customer
DELETE /api/customers/:id          - Delete customer

GET    /api/leads                  - List leads
POST   /api/leads                  - Create lead
PUT    /api/leads/:id              - Update lead
PATCH  /api/leads/:id/convert      - Convert lead to customer
DELETE /api/leads/:id              - Delete lead

GET    /api/followups              - List follow-ups
POST   /api/followups              - Create follow-up
PUT    /api/followups/:id          - Update follow-up
DELETE /api/followups/:id          - Delete follow-up
```

### Finance
```
GET    /api/purchases              - List purchases
GET    /api/purchases/:id          - Get purchase details
POST   /api/purchases              - Create purchase (auto stock-in)
PUT    /api/purchases/:id          - Update purchase
DELETE /api/purchases/:id          - Delete purchase
GET    /api/purchases/suppliers/all - List suppliers
POST   /api/purchases/suppliers    - Create supplier
PUT    /api/purchases/suppliers/:id - Update supplier
DELETE /api/purchases/suppliers/:id - Delete supplier

GET    /api/sales                  - List sales
POST   /api/sales                  - Create sale

GET    /api/expenses               - List expenses
POST   /api/expenses               - Create expense
PUT    /api/expenses/:id           - Update expense
DELETE /api/expenses/:id           - Delete expense

GET    /api/payments/receivables   - List payments receivable
GET    /api/payments/payables      - List payments payable
GET    /api/payments/transactions  - List payment transactions
PATCH  /api/payments/receivables/:id/collect - Collect payment from customer
PATCH  /api/payments/payables/:id/pay - Pay supplier
GET    /api/payments/profit-loss   - Profit & Loss report
GET    /api/payments/ledger/customer - Customer ledger
GET    /api/payments/ledger/supplier - Supplier ledger
```

### HR
```
GET    /api/employees              - List employees
GET    /api/employees/:id          - Get employee details
POST   /api/employees              - Create employee
PUT    /api/employees/:id          - Update employee
DELETE /api/employees/:id          - Delete employee
GET    /api/employees/attendance/list - List attendance
POST   /api/employees/attendance/mark - Mark attendance
GET    /api/employees/salary/records - List salary records
POST   /api/employees/salary/records - Create salary record
PATCH  /api/employees/salary/records/:id/pay - Mark salary as paid
```

### System
```
GET    /api/notifications          - List notifications
PATCH  /api/notifications/:id/read - Mark notification as read
PATCH  /api/notifications/mark-all-read - Mark all as read
DELETE /api/notifications/:id      - Delete notification

GET    /api/documents              - List documents
POST   /api/documents              - Upload documents (multipart/form-data)
DELETE /api/documents/:id          - Delete document

GET    /api/subscriptions          - List subscriptions
POST   /api/subscriptions          - Create subscription
PATCH  /api/subscriptions/:id/cancel - Cancel subscription

GET    /api/reports/dashboard      - Dashboard analytics & stats
```

---

## 🔑 Demo Credentials

After running `npm run seed`:

- **Email**: `ezyenquiry@gmail.com`
- **Password**: `ezyenquiry@123`
- **Role**: Super Admin

---

## 📂 Project Structure

```
Ezyenquiry-backend/
├── src/
│   ├── controllers/       # Business logic
│   │   ├── authController.js
│   │   ├── companyController.js
│   │   ├── userController.js
│   │   ├── productController.js
│   │   ├── inventoryController.js
│   │   ├── enquiryController.js
│   │   ├── orderController.js
│   │   ├── dispatchController.js
│   │   ├── crmController.js
│   │   ├── financeController.js
│   │   ├── hrController.js
│   │   └── systemController.js
│   ├── db/
│   │   └── database.js    # MongoDB connection
│   ├── middleware/
│   │   ├── auth.js        # JWT authentication
│   │   ├── rateLimiter.js # Rate limiting
│   │   ├── errorHandler.js# Global error handler
│   │   └── upload.js      # File upload (multer)
│   ├── routes/            # API routes
│   │   ├── index.js       # Main router
│   │   ├── authRoutes.js
│   │   ├── companyRoutes.js
│   │   ├── userRoutes.js
│   │   ├── productRoutes.js
│   │   ├── categoryRoutes.js
│   │   ├── brandRoutes.js
│   │   ├── inventoryRoutes.js
│   │   ├── enquiryRoutes.js
│   │   ├── orderRoutes.js
│   │   ├── dispatchRoutes.js
│   │   ├── customerRoutes.js
│   │   ├── leadRoutes.js
│   │   ├── followupRoutes.js
│   │   ├── purchaseRoutes.js
│   │   ├── salesRoutes.js
│   │   ├── expenseRoutes.js
│   │   ├── paymentRoutes.js
│   │   ├── employeeRoutes.js
│   │   ├── reportRoutes.js
│   │   ├── notificationRoutes.js
│   │   ├── documentRoutes.js
│   │   └── subscriptionRoutes.js
│   ├── utils/
│   │   ├── logger.js      # Winston logger
│   │   ├── helpers.js     # Helper functions
│   │   ├── otp.js         # OTP generation & verification
│   │   └── mailer.js      # Email sending
│   └── server.js          # Express app & server
├── uploads/               # Uploaded files
│   ├── documents/
│   ├── images/
│   └── avatars/
├── logs/                  # Application logs
├── .env                   # Environment variables
├── .env.example           # Environment template
├── package.json
└── README.md
```

---

## 🔒 Security Features

- JWT-based authentication
- Password hashing with bcrypt (12 rounds)
- Rate limiting (100 req/15min per IP)
- Helmet for security headers
- CORS configured for frontend URL
- SQL injection prevention (parameterized queries)
- XSS protection
- File upload validation (type + size)

---

## 📊 Database Schema

32 tables covering all modules:

1. companies
2. users
3. otp_store
4. refresh_tokens
5. roles
6. branches
7. warehouses
8. categories
9. brands
10. products
11. inventory
12. stock_transfers
13. customers
14. leads
15. followups
16. enquiries
17. orders
18. dispatches
19. suppliers
20. purchases
21. sales
22. expenses
23. payments_receivable
24. payments_payable
25. payment_transactions
26. employees
27. attendance
28. salary_records
29. notifications
30. documents
31. subscriptions
32. activity_log

---

## 🧪 Testing

```bash
# Run migration
npm run migrate

# Seed demo data
npm run seed

# Test health endpoint
curl http://localhost:5000/health

# Test login
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ezyenquiry@gmail.com","password":"ezyenquiry@123"}'
```

---

## 📈 Performance

- Connection pooling (20 max connections)
- Indexed queries for fast lookups
- Pagination for all list endpoints
- GZIP compression
- Efficient JOIN queries

---

## 🚢 Deployment

### Production Checklist

1. Set `NODE_ENV=production`
2. Use strong `JWT_SECRET` (min 32 chars)
3. Configure PostgreSQL connection pooling
4. Set up HTTPS
5. Enable firewall & security groups
6. Set up daily database backups
7. Configure log rotation
8. Use PM2 or systemd for process management

### Deploy to VPS (Ubuntu)

```bash
# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PostgreSQL 15
sudo apt-get install postgresql postgresql-contrib

# Clone repo
git clone <repo-url>
cd Ezyenquiry-backend
npm install --production

# Setup .env
cp .env.example .env
nano .env

# Run migrations
npm run migrate
npm run seed

# Install PM2
sudo npm install -g pm2

# Start with PM2
pm2 start src/server.js --name ezyenquiry-api
pm2 save
pm2 startup
```

---

## 📝 License

Proprietary — All Rights Reserved

---

## 👥 Support

For issues or feature requests, contact: **ezyenquiry@gmail.com**

---

**Built with ❤️ for the Tiles Industry B2B Marketplace**
