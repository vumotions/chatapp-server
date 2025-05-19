import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import http from 'http'
import path from 'path'
import dotenv from 'dotenv'

// Đảm bảo dotenv được cấu hình ở đầu file
const envPath = path.resolve(__dirname, '../.env')
dotenv.config({ path: envPath })


import { env } from './config/env'
import database from './lib/database'
import initSocket from './lib/socket'
import defaultErrorHandler from './middlewares/error.middleware'
import authRoutes from './routes/auth.routes'
import conversationsRoutes from './routes/conversations.routes'
import friendsRoutes from './routes/friends.routes'
import notificationRoutes from './routes/notifications.routes'
import postsRoutes from './routes/posts.routes'
import userRoutes from './routes/user.routes'
import draftsRoutes from './routes/drafts.routes'
import uploadRoutes from './routes/upload.routes'

const port = env.PORT

const app = express()
database.connect()

app.use(express.static(path.join(__dirname, 'public')))
app.use(express.json())
app.use(helmet())
app.use(cors())
app.use(express.urlencoded({ extended: true }))

app.use('/api/auth', authRoutes)
app.use('/api/user', userRoutes)
app.use('/api/chat', conversationsRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/friends', friendsRoutes)
app.use('/api/posts', postsRoutes)
app.use('/api/chat/drafts', draftsRoutes)
app.use('/api/upload', uploadRoutes)

app.use(defaultErrorHandler)

const server = http.createServer(app)

// Khởi tạo socket trước khi khởi động server
;(async () => {
  try {
    console.log('Initializing Socket.io...')
    const socketIo = await initSocket(server)
    app.set('io', socketIo)
    console.log('Socket.io initialized and stored in app')

    // Khởi động server sau khi socket đã được khởi tạo
    server.listen(port, () => {
      console.log(`Server running at http://localhost:${port}`)
    })
  } catch (error) {
    console.error('Failed to initialize Socket.io:', error)
    // Vẫn khởi động server ngay cả khi socket khởi tạo thất bại
    server.listen(port, () => {
      console.log(`Server running at http://localhost:${port} (without Socket.io)`)
    })
  }
})()
