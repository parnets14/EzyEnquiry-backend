/**
 * seed-full-flow.js
 *
 * Populates EVERY module with linked demo data by calling the REAL backend
 * REST API as the admin user. Because it goes through the API, all business
 * flows fire naturally (auto codes, stock-in on purchase receive, and the
 * dispatch -> deliver -> auto Sale + Receivable chain).
 *
 * PREREQUISITE: the backend server must be RUNNING (npm run dev) on API_BASE.
 *
 * Run:  node seed-full-flow.js
 *
 * Admin credentials are read from .env (SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD)
 * and fall back to the seeder defaults.
 */
require('dotenv').config()

const API_BASE = process.env.SEED_API_BASE || `http://localhost:${process.env.PORT || 5000}/api`
const ADMIN_EMAIL    = process.env.SUPER_ADMIN_EMAIL    || 'ezyenquiry@gmail.com'
const ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'ezyenquiry@123'

let TOKEN = ''

// ── tiny colored logger ───────────────────────────────────────
const ok   = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const info = (m) => console.log(`\x1b[36m${m}\x1b[0m`)
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`)
const fail = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`)

// ── low-level request + envelope unwrap ───────────────────────
async function req(method, path, body, isForm = false) {
  const headers = {}
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`
  let payload
  if (body !== undefined) {
    if (isForm) {
      payload = body // URLSearchParams / FormData
    } else {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }
  }

  const res = await fetch(`${API_BASE}${path}`, { method, headers, body: payload })
  let json = null
  try { json = await res.json() } catch { /* non-json */ }

  if (!res.ok || (json && json.success === false)) {
    const msg = json?.message || `${res.status} ${res.statusText}`
    const err = new Error(msg)
    err.status = res.status
    throw err
  }
  // API envelope: { success, message, data }
  return json?.data !== undefined ? json.data : json
}

const get   = (p)          => req('GET', p)
const post  = (p, b)       => req('POST', p, b)
const patch = (p, b)       => req('PATCH', p, b)
const put   = (p, b)       => req('PUT', p, b)

// product create is multipart — send fields as form data (no files)
async function postProduct(fields) {
  const form = new URLSearchParams()
  Object.entries(fields).forEach(([k, v]) => {
    if (v === undefined || v === null) return
    form.append(k, typeof v === 'boolean' ? String(v) : String(v))
  })
  return req('POST', '/products', form, true)
}

const idOf = (o) => o?._id || o?.id

// resolve an existing record by a matcher (so re-runs don't duplicate)
function findBy(list, pred) { return (Array.isArray(list) ? list : []).find(pred) }

// ──────────────────────────────────────────────────────────────
async function main() {
  info('\n════════════════════════════════════════════════════')
  info('  EZYENQUIRY — FULL-FLOW API SEED')
  info(`  API: ${API_BASE}`)
  info('════════════════════════════════════════════════════\n')

  // ── 0. Confirm server is up ─────────────────────────────────
  try {
    await fetch(`${API_BASE.replace(/\/api$/, '')}/health`).then(r => r.json())
  } catch {
    fail('Backend not reachable. Start it first:  npm run dev')
    process.exit(1)
  }

  // ── 1. Login as admin ───────────────────────────────────────
  info('▶ Auth')
  const loginData = await post('/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  TOKEN = loginData.token
  const me = loginData.user
  ok(`Logged in as ${me.name} (${me.role})`)

  // ── 2. Categories + Sub-categories ──────────────────────────
  info('\n▶ Categories & Sub-categories')
  const existingCats = await get('/categories').catch(() => [])
  const catList = Array.isArray(existingCats) ? existingCats : (existingCats?.categories || existingCats || [])

  async function ensureCategory(name, code) {
    const found = findBy(catList, c => c.name === name && !c.parent_id)
    if (found) { warn(`Category exists: ${name}`); return found }
    const c = await post('/categories', { name, code })
    ok(`Category: ${name}`); catList.push(c); return c
  }
  async function ensureSubCategory(parentId, name, code) {
    const found = findBy(catList, c => c.name === name && String(c.parent_id) === String(parentId))
    if (found) { warn(`Sub-category exists: ${name}`); return found }
    const s = await post('/sub-categories', { category_id: parentId, name, code })
    ok(`Sub-category: ${name}`); catList.push(s); return s
  }

  const catFloor = await ensureCategory('Floor Tiles', 'FLR')
  const catWall  = await ensureCategory('Wall Tiles', 'WLL')
  const subGVT   = await ensureSubCategory(idOf(catFloor), 'GVT Tiles', 'GVT')
  const subKitch = await ensureSubCategory(idOf(catWall), 'Kitchen Wall', 'KWL')

  // ── 3. Brands ───────────────────────────────────────────────
  info('\n▶ Brands')
  const existingBrands = await get('/brands').catch(() => [])
  const brandList = Array.isArray(existingBrands) ? existingBrands : (existingBrands?.brands || [])
  async function ensureBrand(name, code) {
    const found = findBy(brandList, b => b.name === name)
    if (found) { warn(`Brand exists: ${name}`); return found }
    const b = await post('/brands', { name, code })
    ok(`Brand: ${name}`); brandList.push(b); return b
  }
  const brandKajaria = await ensureBrand('Kajaria', 'KAJ')
  const brandSomany  = await ensureBrand('Somany', 'SOM')

  // ── 4. Warehouses ───────────────────────────────────────────
  info('\n▶ Warehouses')
  const existingWh = await get('/warehouses').catch(() => [])
  const whList = Array.isArray(existingWh) ? existingWh : (existingWh?.warehouses || existingWh || [])
  async function ensureWarehouse(name, city, state) {
    const found = findBy(whList, w => w.name === name)
    if (found) { warn(`Warehouse exists: ${name}`); return found }
    const w = await post('/warehouses', { name, city, state, location: city, unit: 'Box', capacity: 5000 })
    ok(`Warehouse: ${name}`); whList.push(w); return w
  }
  const whMain = await ensureWarehouse('Main Warehouse', 'Jaipur', 'Rajasthan')
  await ensureWarehouse('City Depot', 'Ahmedabad', 'Gujarat')

  // ── 5. Suppliers ────────────────────────────────────────────
  info('\n▶ Suppliers')
  const existingSup = await get('/suppliers').catch(() => [])
  const supList = Array.isArray(existingSup) ? existingSup : (existingSup?.suppliers || [])
  async function ensureSupplier(name, mobile, city) {
    const found = findBy(supList, s => s.mobile === mobile || s.name === name)
    if (found) { warn(`Supplier exists: ${name}`); return found }
    const s = await post('/suppliers', { name, mobile, city, state: 'Rajasthan', credit_days: 30 })
    ok(`Supplier: ${name}`); supList.push(s); return s
  }
  const sup1 = await ensureSupplier('Morbi Ceramics Ltd', '9811111111', 'Morbi')
  await ensureSupplier('Rajasthan Tile Traders', '9822222222', 'Jaipur')

  // ── 6. Employees ────────────────────────────────────────────
  info('\n▶ Employees')
  const existingEmp = await get('/employees').catch(() => [])
  const empList = Array.isArray(existingEmp) ? existingEmp : (existingEmp?.employees || [])
  async function ensureEmployee(name, mobile, designation, department) {
    const found = findBy(empList, e => e.mobile === mobile || e.name === name)
    if (found) { warn(`Employee exists: ${name}`); return found }
    const e = await post('/employees', {
      name, mobile, designation, department,
      email: `${name.toLowerCase().replace(/\s+/g, '.')}@ezyenquiry.com`,
      join_date: '2025-01-15', salary: 35000, branch: 'Head Office',
    })
    ok(`Employee: ${name}`); empList.push(e); return e
  }
  await ensureEmployee('Suresh Menon', '9833333331', 'Sales Executive', 'Sales')
  await ensureEmployee('Priya Nair', '9833333332', 'Accountant', 'Finance')

  // ── 7. Customers ────────────────────────────────────────────
  info('\n▶ Customers')
  const existingCust = await get('/customers').catch(() => [])
  const custList = Array.isArray(existingCust) ? existingCust : (existingCust?.customers || [])
  async function ensureCustomer(name, mobile, city) {
    const found = findBy(custList, c => c.mobile === mobile || c.name === name)
    if (found) { warn(`Customer exists: ${name}`); return found }
    const c = await post('/customers', {
      name, mobile, city, state: 'Gujarat',
      email: `${name.toLowerCase().replace(/\s+/g, '')}@example.com`,
      biz_type: 'Retailer', credit_limit: 100000,
    })
    ok(`Customer: ${name}`); custList.push(c); return c
  }
  const custShree = await ensureCustomer('Shree Tiles Shop', '9876500001', 'Ahmedabad')
  const custRoyal = await ensureCustomer('Royal Interiors', '9876500002', 'Surat')

  // ── 8. Products ─────────────────────────────────────────────
  info('\n▶ Products')
  const existingProd = await get('/products?limit=200').catch(() => [])
  const prodList = Array.isArray(existingProd) ? existingProd : (existingProd?.products || [])
  const PRODUCTS = [
    { code: 'SEED-KAJ-001', name: 'Marble Elegance 600x600', category_id: idOf(catFloor), sub_category_id: idOf(subGVT), brand_id: idOf(brandKajaria), size: '600x600', finish: 'Glossy', color: 'White', tile_type: 'GVT', purchase_price: 40, selling_price: 45, dealer_price: 50, retail_price: 55, mrp: 65, gst_percent: 18, pcs_per_box: 4, sqft_per_box: 15.5, unit: 'Box' },
    { code: 'SEED-KAJ-002', name: 'Rustic Wood 600x1200', category_id: idOf(catFloor), sub_category_id: idOf(subGVT), brand_id: idOf(brandKajaria), size: '600x1200', finish: 'Matt', color: 'Brown', tile_type: 'GVT', purchase_price: 60, selling_price: 65, dealer_price: 72, retail_price: 80, mrp: 95, gst_percent: 18, pcs_per_box: 2, sqft_per_box: 15.5, unit: 'Box' },
    { code: 'SEED-SOM-003', name: 'Classic Beige 800x800', category_id: idOf(catFloor), brand_id: idOf(brandSomany), size: '800x800', finish: 'Glossy', color: 'Beige', tile_type: 'Vitrified', purchase_price: 50, selling_price: 55, dealer_price: 62, retail_price: 70, mrp: 85, gst_percent: 18, pcs_per_box: 3, sqft_per_box: 20.6, unit: 'Box' },
    { code: 'SEED-SOM-004', name: 'Kitchen Splash 300x600', category_id: idOf(catWall), sub_category_id: idOf(subKitch), brand_id: idOf(brandSomany), size: '300x600', finish: 'Glossy', color: 'Ivory', tile_type: 'Wall Tile', purchase_price: 22, selling_price: 28, dealer_price: 32, retail_price: 38, mrp: 45, gst_percent: 18, pcs_per_box: 6, sqft_per_box: 12.0, unit: 'Box' },
  ]
  const products = {}
  for (const p of PRODUCTS) {
    const found = findBy(prodList, x => x.code === p.code)
    if (found) { warn(`Product exists: ${p.name}`); products[p.code] = found; continue }
    const created = await postProduct({ ...p, online_visible: true, is_active: true })
    ok(`Product: ${p.name} (${created.code})`)
    products[p.code] = created
  }

  // ── 9. Purchases -> Approve -> Receive (stock-in) ───────────
  info('\n▶ Purchases (with stock-in)')
  const purchasesToMake = [
    { product: 'SEED-KAJ-001', qty: 100, rate: 40 },
    { product: 'SEED-KAJ-002', qty: 60,  rate: 60 },
    { product: 'SEED-SOM-003', qty: 80,  rate: 50 },
    { product: 'SEED-SOM-004', qty: 120, rate: 22 },
  ]
  for (const pu of purchasesToMake) {
    const prod = products[pu.product]
    if (!prod) { warn(`Skip purchase — missing product ${pu.product}`); continue }
    try {
      const purchase = await post('/purchases', {
        supplier_id: idOf(sup1), supplier_name: sup1.name,
        product_id: idOf(prod), product_name: prod.name,
        warehouse_id: idOf(whMain),
        qty: pu.qty, rate: pu.rate, gst_percent: 18,
        invoice_number: `SUP-INV-${pu.product}`,
        purchase_date: new Date().toISOString().slice(0, 10),
      })
      const pid = idOf(purchase)
      await patch(`/purchases/${pid}/status`, { status: 'Approved' })
      await patch(`/purchases/${pid}/status`, { status: 'Received' })
      ok(`Purchase ${purchase.purchase_code}: ${pu.qty} × ${prod.name} → stock-in done`)
    } catch (e) {
      fail(`Purchase for ${pu.product}: ${e.message}`)
    }
  }

  // ── 10. CRM: Leads -> Convert -> Follow-ups ─────────────────
  info('\n▶ CRM (leads, follow-ups)')
  const lead1 = await post('/leads', { name: 'Mehul Desai', mobile: '9870000011', source: 'Website', notes: 'Interested in floor tiles for a villa project' })
  ok(`Lead: ${lead1.name}`)
  const lead2 = await post('/leads', { name: 'Anita Shah', mobile: '9870000012', source: 'Referral', notes: 'Bathroom renovation' })
  ok(`Lead: ${lead2.name}`)
  try {
    const conv = await patch(`/leads/${idOf(lead1)}/convert`)
    ok(`Converted lead ${lead1.name} → customer ${conv?.customer?.name || ''}`)
  } catch (e) { warn(`Lead convert: ${e.message}`) }
  await post('/followups', { lead_id: idOf(lead2), notes: 'Call back with bathroom tile catalogue', followup_date: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10) })
  ok('Follow-up scheduled for Anita Shah')
  await post('/followups', { customer_id: idOf(custShree), notes: 'Confirm repeat order for GVT tiles', followup_date: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) })
  ok('Follow-up scheduled for Shree Tiles Shop')

  // ── 11. Marketplace flow: Enquiry -> Order -> Dispatch -> Deliver
  info('\n▶ Marketplace flow (enquiry → order → dispatch → deliver)')
  const ORDER_LADDER = [
    'Pending Approval', 'Approved', 'Picking Started', 'Picking Completed',
    'Sorting Started', 'Sorting Completed', 'Packing Started', 'Packing Completed',
    'Invoice Generated', 'Ready for Dispatch',
  ]

  async function runOneFlow({ customer, product, qty, rate, deliver }) {
    const prod = products[product]
    // 11a. Enquiry
    const enq = await post('/enquiries', {
      retailer_name: customer.name, retailer_mobile: customer.mobile,
      location: customer.city || 'Ahmedabad',
      product_id: idOf(prod), product_code: prod.code, product_name: prod.name,
      qty, unit: 'Box', offered_price: rate,
      remarks: 'Seeded enquiry',
    })
    ok(`Enquiry ${enq.enq_code} — ${customer.name} for ${prod.name}`)

    // 11b. Confirm the enquiry so it can convert
    await patch(`/enquiries/${idOf(enq)}`, { status: 'Confirmed', offered_price: rate })

    // 11c. Order from enquiry
    const order = await post('/orders/from-enquiry', {
      enquiry_id: idOf(enq), rate, gst_percent: 18,
      delivery_address: `${customer.name}, ${customer.city || 'Ahmedabad'}`,
      notes: 'Seeded order',
    })
    ok(`Order ${order.order_code} created`)

    if (!deliver) return

    // 11d. Step the order up to Ready for Dispatch
    const oid = idOf(order)
    for (const status of ORDER_LADDER) {
      await patch(`/orders/${oid}/status`, { status, remarks: `Seed → ${status}` })
    }
    ok('Order stepped to "Ready for Dispatch"')

    // 11e. Dispatch
    const dispatch = await post('/dispatches', {
      order_id: oid, transport_name: 'Blue Dart Logistics',
      lr_number: `LR-${Date.now().toString().slice(-6)}`,
      vehicle_number: 'RJ14 GA 2024', driver_name: 'Ramesh', driver_mobile: '9812345678',
      delivery_address: `${customer.name}, ${customer.city || 'Ahmedabad'}`,
    })
    ok(`Dispatch ${dispatch.dispatch_code} created`)

    // 11f. In transit → Delivered (auto Sale + Receivable)
    const did = idOf(dispatch)
    await patch(`/dispatches/${did}/intransit`)
    await patch(`/dispatches/${did}/deliver`, { delivered_date: new Date().toISOString().slice(0, 10), pod_remarks: 'Delivered in good condition' })
    ok('Delivered → Sale + Receivable auto-created')
    return { order, dispatch }
  }

  // Two fully delivered flows + one that stays as an open enquiry/order
  await runOneFlow({ customer: custShree, product: 'SEED-KAJ-001', qty: 10, rate: 55, deliver: true })
  await runOneFlow({ customer: custRoyal, product: 'SEED-SOM-003', qty: 8,  rate: 70, deliver: true })
  await runOneFlow({ customer: custShree, product: 'SEED-SOM-004', qty: 15, rate: 38, deliver: false })

  // ── 12. Quotations ──────────────────────────────────────────
  info('\n▶ Quotations')
  const qProd = products['SEED-KAJ-002']
  const qty = 12, rate = 80, disc = 5
  const lineTotal = +(qty * rate * (1 - disc / 100)).toFixed(2)
  const gstAmt = +(lineTotal * 0.18).toFixed(2)
  await post('/quotations', {
    customer_name: custRoyal.name, customer_phone: custRoyal.mobile,
    quotation_date: new Date().toISOString().slice(0, 10),
    valid_until: new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10),
    items: [{
      product_id: idOf(qProd), product_name: qProd.name, product_code: qProd.code,
      brand_name: 'Kajaria', size: qProd.size, finish: qProd.finish,
      unit: 'Box', gst_percent: 18, mrp: qProd.mrp, retail_price: qProd.retail_price,
      dealer_price: qProd.dealer_price, pcs_per_box: qProd.pcs_per_box, sqft_per_box: qProd.sqft_per_box,
      qty, rate, disc, total: lineTotal,
    }],
    subtotal: lineTotal, gst_amount: gstAmt, grand_total: +(lineTotal + gstAmt).toFixed(2),
    remarks: 'Seeded quotation', terms: 'Payment within 15 days',
  })
  ok('Quotation created for Royal Interiors')

  // ── 13. Expenses ────────────────────────────────────────────
  info('\n▶ Expenses')
  await post('/expenses', { category: 'Transport', amount: 4500, description: 'Delivery vehicle fuel', payment_mode: 'Cash', expense_date: new Date().toISOString().slice(0, 10) })
  await post('/expenses', { category: 'Office Rent', amount: 25000, description: 'Monthly showroom rent', payment_mode: 'Bank Transfer', expense_date: new Date().toISOString().slice(0, 10) })
  ok('2 expenses recorded')

  // ── 14. Collect a receivable payment ────────────────────────
  info('\n▶ Payments (collect receivable)')
  try {
    const rcvRes = await get('/payments/receivables?limit=100')
    const receivables = Array.isArray(rcvRes) ? rcvRes : (rcvRes?.receivables || [])
    const openRcv = receivables.find(r => (r.outstanding ?? r.total ?? 0) > 0)
    if (openRcv) {
      const amount = Math.round((openRcv.outstanding || openRcv.total || 0) * 0.5)
      await patch(`/payments/receivables/${idOf(openRcv)}/collect`, { amount, mode: 'UPI', reference: 'SEED-UPI-001', notes: 'Partial payment (seed)' })
      ok(`Collected ₹${amount} against receivable ${openRcv.rcv_code || idOf(openRcv)}`)
    } else {
      warn('No open receivable found to collect (deliver flow may have been skipped)')
    }
  } catch (e) { warn(`Collect receivable: ${e.message}`) }

  info('\n════════════════════════════════════════════════════')
  info('  ✓ SEED COMPLETE — data added across all modules')
  info('════════════════════════════════════════════════════')
  info('  Login to the CRM as:')
  info(`    Email:    ${ADMIN_EMAIL}`)
  info(`    Password: ${ADMIN_PASSWORD}`)
  info('════════════════════════════════════════════════════\n')
}

main().catch(err => {
  fail(`\nSeed aborted: ${err.message}`)
  if (err.status) fail(`HTTP status: ${err.status}`)
  process.exit(1)
})
