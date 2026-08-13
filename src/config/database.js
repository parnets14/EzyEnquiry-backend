const mongoose = require('mongoose')

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
