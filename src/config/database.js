const mongoose = require('mongoose')
const dns = require('dns')

// On some networks the configured DNS server refuses Node's SRV queries
// (querySrv ECONNREFUSED), which breaks mongodb+srv:// connections even
// though nslookup works. Force public resolvers so SRV lookups succeed.
dns.setServers(['8.8.8.8', '1.1.1.1'])

const connectDB = async () => {
  console.log('[DB] Connecting to MongoDB...')
  const uri = process.env.MONGO_URI || ''

  try {
    const conn = await mongoose.connect(uri, {
      dbName: 'ezyenquiry',
    })

    console.log(`[DB] ✓ MongoDB connected: ${conn.connection.host}`)

    mongoose.connection.on('disconnected', () => {
      console.warn('[DB] ⚠  MongoDB disconnected — will auto-reconnect')
    })

    mongoose.connection.on('reconnected', () => {
      console.log('[DB] ✓ MongoDB reconnected')
    })

    mongoose.connection.on('error', (err) => {
      console.error('[DB] ✗ MongoDB error:', err.message)
    })
  } catch (error) {
    console.error('[DB] ✗ MongoDB connection failed:', error.message)
    process.exit(1)
  }
}

module.exports = connectDB
