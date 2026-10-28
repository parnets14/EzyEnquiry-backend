require('dotenv').config()
const m = require('mongoose')
;(async () => {
  await m.connect(process.env.MONGO_URI)
  const C = require('./src/models/Company Management/Company')
  const U = require('./src/models/User Management/User')
  const cos = await C.find({}).select('name company_code mobile status is_active').lean()
  if (!cos.length) console.log('No companies found.')
  for (const c of cos) {
    const o = await U.findOne({ company_id: c._id, role: 'Company Owner' }).select('mobile is_active').lean()
    console.log(
      [
        String(c.status).padEnd(9),
        String(c.company_code || '-').padEnd(7),
        'companyMobile=' + String(c.mobile || '-').padEnd(12),
        'ownerMobile=' + String(o && o.mobile || '-').padEnd(12),
        c.name,
      ].join(' | ')
    )
  }
  await m.disconnect()
})().catch((e) => { console.error(e.message); process.exit(1) })
