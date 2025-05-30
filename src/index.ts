import cors, { CorsOptions } from 'cors'
import express from 'express'
import helmet from 'helmet'
import http from 'http'
import path from 'path'
import dotenv from 'dotenv'

// Đảm bảo dotenv được cấu hình ở đầu file
const envPath = path.resolve(__dirname, '../.env')
dotenv.config({ path: envPath })

// Thêm vào đầu file
import 'tsconfig-paths/register'

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
import searchRoutes from './routes/search.routes'

const port = env.PORT

const app = express()
database.connect()
const CLIENT_URL = 'https://social-media-client-eosin.vercel.app'
export const isProduction = process.env.PRODUCTION === 'production'
const corsOptions: CorsOptions = {
  origin: isProduction ? CLIENT_URL : true, // true cho phép tất cả trong development
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}
app.use(express.static(path.join(__dirname, 'public')))
app.use(express.json())
app.use(helmet())
app.use(cors(corsOptions))
app.options('*', cors(corsOptions))
app.use(express.urlencoded({ extended: true }))

app.use('/api/auth', authRoutes)
app.use('/api/user', userRoutes)
app.use('/api/chat', conversationsRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/friends', friendsRoutes)
app.use('/api/posts', postsRoutes)
app.use('/api/chat/drafts', draftsRoutes)
app.use('/api/upload', uploadRoutes)
app.use('/api/search', searchRoutes)

app.use(defaultErrorHandler)

const server = http.createServer(app)
initSocket(server)
// Khởi tạo socket trước khi khởi động server
const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`)
})
