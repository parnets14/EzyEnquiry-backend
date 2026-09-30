/**
 * migrate-inventory-index.js
 *
 * Replaces the `inventories` unique index
 *
 *     product_id_1_warehouse_id_1            →  { product_id, warehouse_id }
 *
 * with the correct, company-scoped one
 *
 *     company_id_1_product_id_1_warehouse_id_1 → { company_id, product_id, warehouse_id }
 *
 * WHY THIS IS NEEDED
 * ------------------
 * Stock buckets belong to a company, but the old unique key omitted company_id.
 * That meant only ONE company in the whole database could ever hold an inventory
 * row for a given product. Every other company's stock-in upsert matched no
 * document, tried to insert, and died with:
 *
 *     E11000 duplicate key error collection: ezyenquiry.inventories
 *     index: product_id_1_warehouse_id_1 dup key: { product_id: ..., warehouse_id: null }
 *
 * → unhandled → HTTP 500 on POST /api/retailer/erp/purchases ("Buy Item") and on
 * every other endpoint that stocks a product owned by a different company.
 *
 * SAFETY
 * ------
 * The new key is a strict superset of the old one. If the old key is unique then
 * the new key is necessarily unique too, so building the new index cannot fail
 * and no insert that used to succeed will now be rejected. The change is purely
 * a relaxation: it only allows inserts that were previously (wrongly) blocked.
 *
 * The new index is built BEFORE the old one is dropped, so there is no window in
 * which the collection is unprotected by a unique constraint.
 *
 * Usage:  node migrate-inventory-index.js
 *         node migrate-inventory-index.js --dry-run
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');

const OLD_INDEX = 'product_id_1_warehouse_id_1';
const NEW_INDEX = 'company_id_1_product_id_1_warehouse_id_1';
const NEW_KEY   = { company_id: 1, product_id: 1, warehouse_id: 1 };

const DRY_RUN = process.argv.includes('--dry-run');

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
  const db = mongoose.connection.db;
  const inv = db.collection('inventories');

  const before = await inv.indexes();
  const names  = before.map(i => i.name);
  const docs   = await inv.estimatedDocumentCount();

  console.log(`Database      : ${db.databaseName}`);
  console.log(`Collection    : inventories (${docs} documents)`);
  console.log(`Existing      : ${names.join(', ')}`);
  console.log(`Mode          : ${DRY_RUN ? 'DRY RUN — no changes' : 'APPLY'}\n`);

  // ── Guard: a unique index cannot be built over existing duplicates ──────────
  const dupes = await inv.aggregate([
    { $group: { _id: { company_id: '$company_id', product_id: '$product_id', warehouse_id: '$warehouse_id' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $limit: 5 },
  ]).toArray();

  if (dupes.length) {
    console.error('ABORT — the new key already has duplicates, so a unique index cannot be built:');
    console.error(JSON.stringify(dupes, null, 2));
    console.error('Resolve these rows first, then re-run.');
    process.exit(1);
  }
  console.log(`Pre-check     : no duplicates on { company_id, product_id, warehouse_id }`);

  if (DRY_RUN) {
    console.log(`\nWould create : ${NEW_INDEX}`);
    if (names.includes(OLD_INDEX)) console.log(`Would drop   : ${OLD_INDEX}`);
    else console.log(`Would drop   : (nothing — ${OLD_INDEX} is already gone)`);
    await mongoose.disconnect();
    return;
  }

  // ── 1. Build the new index first (keeps the collection protected) ───────────
  if (names.includes(NEW_INDEX)) {
    console.log(`Create        : ${NEW_INDEX} — already present, skipped`);
  } else {
    await inv.createIndex(NEW_KEY, { unique: true, name: NEW_INDEX });
    console.log(`Create        : ${NEW_INDEX} — created`);
  }

  // ── 2. Only now drop the old, company-blind index ───────────────────────────
  if (names.includes(OLD_INDEX)) {
    await inv.dropIndex(OLD_INDEX);
    console.log(`Drop          : ${OLD_INDEX} — dropped`);
  } else {
    console.log(`Drop          : ${OLD_INDEX} — not present, skipped`);
  }

  // ── 3. Report ──────────────────────────────────────────────────────────────
  const after = await inv.indexes();
  const uniques = after.filter(i => i.unique).map(i => i.name);
  console.log(`\nResult        : ${after.map(i => i.name).join(', ')}`);
  console.log(`Unique keys   : ${uniques.join(', ')}`);

  const stillOld = after.some(i => i.name === OLD_INDEX);
  const hasNew   = after.some(i => i.name === NEW_INDEX);
  if (stillOld || !hasNew) {
    console.error('\nFAILED — index state is not what was expected.');
    process.exit(1);
  }
  console.log('\nOK — several companies can now stock the same product without E11000.');

  await mongoose.disconnect();
})().catch(async err => {
  console.error('\nMIGRATION FAILED:', err.message);
  try { await mongoose.disconnect(); } catch { /* already down */ }
  process.exit(1);
});
