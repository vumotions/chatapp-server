import mongoose from 'mongoose'
import { config } from 'dotenv'

config()

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || '', {
      // Thêm tùy chọn strictPopulate: false
      // @ts-ignore - Mongoose 7 không có strictPopulate trong TypeScript definitions
      strictPopulate: false
    })
    console.log(`MongoDB Connected: ${conn.connection.host}`)
  } catch (error) {
    console.error(`Error: ${error}`)
    process.exit(1)
  }
}

export default connectDB