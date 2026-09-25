const mongoose = require('mongoose');
const Purchase    = require('../models/Purchase & Inventory Management/Purchase');
const Payable     = require('../models/Finance Management/Payable');
const Inventory   = require('../models/Purchase & Inventory Management/Inventory');
const Product     = require('../models/Product Management/Product');
const Company     = require('../models/Company Management/Company');
const User        = require('../models/User Management/User');
const Notification = require('../models/System Management/Notification');
const { notifyStockOwner } = require('../controllers/Purchase & Inventory Management/inventoryController');

/**
 * Scheduled daily runner.
 *
 * 1. Purchase Overdue reminder:
 *      For EVERY company → find all Purchase bills with status !=
 *      Cancelled, due_date < today, payment_status != Paid (includes
 *      Partially Paid) → create Notification per bill + attempt mail.
 *
 * 2. Low-stock daily digest (per company):
 *      For EVERY company → find all Inventory records where
 *      available_stock <= low_stock_alert AND low_stock_alert > 0
 *      → compile a digest → create 1 Notification per company (Owner/Manager).
 *
 * Caller may run this via setInterval on boot or trigger manually from a
 * maintenance endpoint.  Function is safe to re-run (multiple calls in one
 * day) because the individual Notification creators in purchase+inventory
 * paths already use internal dedup logic.
 */
async function runDailyReminders() {
  const start = Date.now();
  console.log('[reminders] Daily reminder run started.');

  let companies = [];
  try {
    // Distinct company list — from both companies with active products
    // and companies with purchases.  Union across both in case a company
    // has purchases but no inventory yet.
    const [fromCompany, fromPurchase] = await Promise.all([
      Company.distinct('_id', { status: { $ne: 'suspended' } }).catch(() => []),
      Purchase.distinct('company_id').catch(() => []),
    ]);
    const set = new Set();
    fromCompany.forEach(id => set.add(String(id)));
    fromPurchase.forEach(id => id && set.add(String(id)));
    companies = [...set].map(id => new mongoose.Types.ObjectId(id));
  } catch (e) {
    console.warn('[reminders] Could not build company list:', e.message);
    return;
  }

  let overdueBills = 0;
  let lowStock     = 0;

  for (const companyId of companies) {
    // ── 1. Overdue purchases / payables ─────────────────────────────
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const overdue = await Purchase.aggregate([
        { $match: {
          company_id: companyId,
          status:     { $ne: 'Cancelled' },
          payment_status: { $ne: 'Paid' },
          due_date:   { $lt: todayStart, $exists: true, $ne: null },
        }},
        { $lookup: {
          from: 'suppliers', localField: 'supplier_id',
          foreignField: '_id', as: 'sup'
        }},
        { $project: {
          purchase_code: 1, bill_code: 1, due_date: 1,
          total_amount: 1, payment_status: 1,
          amount_paid: 1, supplier_name: 1,
          supplier_id: 1,
        }},
      ]).allowDiskUse(true);

      // Also check stand-alone payables that may not have a purchase link
      const payableOverdue = await Payable.find({
        company_id: companyId,
        status:     { $nin: ['Paid'] },
        due_date:   { $lt: todayStart, $exists: true, $ne: null },
      }).select('_id payable_code invoice_amount paid outstanding due_date supplier_name supplier_id purchase_id').lean();

      const allOverdueItems = [
        ...overdue.map(p => ({
          kind: 'purchase',
          _id: p._id,
          code: p.purchase_code || p.bill_code,
          supplier: p.supplier_name,
          due: p.due_date,
          total: p.total_amount,
          paid: p.amount_paid || 0,
          balance: (p.total_amount || 0) - (p.amount_paid || 0),
          status: p.payment_status,
        })),
        ...payableOverdue.map(p => ({
          kind: 'payable',
          _id: p._id,
          code: p.payable_code,
          supplier: p.supplier_name,
          due: p.due_date,
          total: p.invoice_amount,
          paid: p.paid || 0,
          balance: p.outstanding,
          status: p.status,
        })),
      ];

      // Owner/Manager list for this company
      const ownerOrManagers = await User.find({
        company_id: companyId,
        role: { $in: ['Company Owner', 'Manager', 'Admin'] },
        is_active: true,
      }).select('_id name').lean();

      for (const item of allOverdueItems) {
        overdueBills += 1;
        const dueStr = item.due ? new Date(item.due).toLocaleDateString() : 'unknown';
        const msg = `Supplier bill ${item.code} ${item.supplier ? '('+item.supplier+')' : ''} is overdue since ${dueStr}. Balance: ₹${Number(item.balance||0).toLocaleString('en-IN')}.`;

        for (const user of ownerOrManagers) {
          try {
            await Notification.create({
              company_id: companyId,
              user_id:    user._id,
              type:       'purchase_overdue',
              kind:       'purchase_overdue',
              title:      `Bill Overdue — ${item.code}`,
              message:    msg,
              reference_id: item._id,
            });
          } catch (_) {}
        }
      }
    } catch (e) {
      console.warn(`[reminders] Purchase overdue scan failed for ${companyId}:`, e.message);
    }

    // ── 2. Low / Out-of-stock daily digest ─────────────────────────
    try {
      // Records below or equal to the alert threshold
      const lowInv = await Inventory.aggregate([
        { $match: { company_id: companyId } },
        { $addFields: {
          eff_threshold: { $ifNull: ['$low_stock_alert', 0] },
        }},
        { $match: {
          eff_threshold: { $gt: 0 },
          $expr: { $lte: ['$available_stock', '$eff_threshold'] },
        }},
        { $lookup: {
          from: 'products', localField: 'product_id', foreignField: '_id', as: 'prod'
        }},
        { $project: {
          product_id: 1, available_stock: 1, physical_stock: 1,
          low_stock_alert: 1, warehouse_id: 1,
          product_code: { $arrayElemAt: ['$prod.code', 0] },
          product_name: { $arrayElemAt: ['$prod.name', 0] },
        }},
      ]).allowDiskUse(true);

      if (lowInv.length) {
        lowStock += lowInv.length;
        // Digest message (truncated to first 5 items)
        const snippet = lowInv.slice(0, 5).map(r => {
          const name = r.product_name || String(r.product_id);
          const code = r.product_code || '';
          return `• ${code ? `[${code}] ` : ''}${name} — avail ${r.available_stock||0} / threshold ${r.low_stock_alert||0}`;
        }).join('\n');
        const msg = `${lowInv.length} product(s) below their low-stock alert threshold.\n\n${snippet}${lowInv.length>5?`\n... (+${lowInv.length - 5} more)`:''}`;
        const ownerOrManagers = await User.find({
          company_id: companyId,
          role: { $in: ['Company Owner', 'Manager', 'Admin'] },
          is_active: true,
        }).select('_id').lean();
        for (const user of ownerOrManagers) {
          try {
            await Notification.create({
              company_id: companyId,
              user_id:    user._id,
              type:       'low_stock_digest',
              kind:       'low_stock',
              title:      `Daily Low-Stock Digest (${lowInv.length})`,
              message:    msg,
            });
          } catch (_) {}
        }

        // Also fire the per-item individual alerts (benefits from 24h dedup inside notifyStockOwner)
        for (const row of lowInv) {
          try {
            const oos = (row.available_stock || 0) <= 0;
            await notifyStockOwner({
              companyId,
              productId: row.product_id,
              productCode: row.product_code || '',
              productName: row.product_name || '',
              warehouseId: row.warehouse_id || null,
              threshold: row.low_stock_alert || 0,
              available: row.available_stock || 0,
              kind: oos ? 'out_of_stock' : 'low_stock',
            });
          } catch (_) {}
        }
      }
    } catch (e) {
      console.warn(`[reminders] Low-stock scan failed for ${companyId}:`, e.message);
    }
  }

  const elapsed = (Date.now() - start) / 1000;
  console.log(`[reminders] Daily reminder run complete in ${elapsed.toFixed(1)}s — ${overdueBills} overdue bill(s) flagged, ${lowStock} low-stock item(s) flagged.`);
}

/**
 * setInterval wrapper that starts the 24h timer AFTER the DB connection
 * is confirmed.  The FIRST run is fired ~5 minutes after boot (so that
 * cold-start migrations/seeders can finish) then every 24h thereafter.
 */
function scheduleDailyReminders() {
  const MS_5MIN = 5 * 60 * 1000;
  const MS_24H  = 24 * 60 * 60 * 1000;

  // Do NOT double-schedule (server may hot-reload).
  if (scheduleDailyReminders._scheduled) return;
  scheduleDailyReminders._scheduled = true;

  const safeRun = async () => {
    try { await runDailyReminders(); } catch (e) {
      console.error('[reminders] runDailyReminders failed:', e.message);
    }
  };

  setTimeout(safeRun, MS_5MIN);
  setInterval(safeRun, MS_24H);
}

module.exports = { runDailyReminders, scheduleDailyReminders };
