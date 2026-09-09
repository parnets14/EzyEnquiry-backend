require('dotenv').config();
const m = require('mongoose');
(async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL || process.env.DB_URI;
  await m.connect(uri);
  const P = require('./src/models/Product Management/Product');
  const rows = await P.aggregate([
    { $match: { status: { $ne: 'deleted' } } },
    { $group: { _id: '$source', count: { $sum: 1 } } },
  ]);
  console.log('SOURCE BREAKDOWN:', JSON.stringify(rows));
  const samp = await P.find({}).select('name source company_id created_at').sort({ created_at: -1 }).limit(10).lean();
  console.log('RECENT:', JSON.stringify(samp.map(x => ({ name: x.name, source: x.source || '(none)', company: String(x.company_id || '').slice(-6) })), null, 0));
  await m.disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
