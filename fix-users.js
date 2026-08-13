require('dotenv').config()
const connectDB = require('./src/config/database')

connectDB().then(async () => {
  const { UserModel }    = require('./src/models/User')
  const { CompanyModel } = require('./src/models/Company')

  const company = await CompanyModel.findOne({}).lean()
  if (!company) { console.log('No company found — nothing to fix'); process.exit(0) }
  console.log('Using company:', company.name, company._id.toString())

  // Fix users who have company_id missing or null
  const fixed1 = await UserModel.updateMany(
    { company_id: { $exists: false } },
    { $set: { company_id: company._id } }
  )
  const fixed2 = await UserModel.updateMany(
    { company_id: null },
    { $set: { company_id: company._id } }
  )
  console.log('Fixed (missing field):', fixed1.modifiedCount)
  console.log('Fixed (null field)   :', fixed2.modifiedCount)

  const users = await UserModel.find({}).select('name email role company_id').lean()
  console.log('\nAll users after fix:')
  users.forEach(u =>
    console.log(` ${u.name} | ${u.email} | ${u.role} | company: ${u.company_id?.toString() || 'STILL MISSING'}`)
  )

  process.exit(0)
}).catch(e => { console.error(e.message); process.exit(1) })
