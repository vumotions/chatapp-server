import mongoose from 'mongoose'
import { env } from '~/config/env'

type CachedConnection = {
  conn: mongoose.Connection | null
  promise: Promise<mongoose.Connection> | null
}

declare global {
  var mongoose: CachedConnection
}

if (!global.mongoose) {
  global.mongoose = { conn: null, promise: null }
}

class Database {
  private readonly uri: string = `mongodb+srv://${env.DB_USERNAME}:${env.DB_PASSWORD}@teleface-dev.dpnhmv0.mongodb.net/?retryWrites=true&w=majority&appName=teleface-dev`
  private cached: CachedConnection

  constructor() {
    this.cached = global.mongoose
  }

  public async connect(): Promise<mongoose.Connection> {
    if (this.cached.conn) {
      return this.cached.conn
    }

    if (!this.cached.promise) {
      const opts = { bufferCommands: false }
      this.cached.promise = mongoose.connect(this.uri, opts).then((mongoose) => {
        console.log('You successfully connected to MongoDB!')
        return mongoose.connection
      })
    }

    try {
      this.cached.conn = await this.cached.promise
    } catch (error) {
      this.cached.promise = null
      throw error
    }

    return this.cached.conn
  }
}

const db = new Database()
export default db
