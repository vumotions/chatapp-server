import cors, { CorsOptions } from 'cors'
import express, { Request, Response } from 'express'
import helmet from 'helmet'
import http from 'http'
import path from 'path'
import 'tsconfig-paths/register'

// Thêm vào đầu file

import { env } from './config/env'
import database from './lib/database'
import initSocket from './lib/socket'
import defaultErrorHandler from './middlewares/error.middleware'
import authRoutes from './routes/auth.routes'
import conversationsRoutes from './routes/conversations.routes'
import draftsRoutes from './routes/drafts.routes'
import friendsRoutes from './routes/friends.routes'
import notificationRoutes from './routes/notifications.routes'
import postsRoutes from './routes/posts.routes'
import searchRoutes from './routes/search.routes'
import uploadRoutes from './routes/upload.routes'
import userRoutes from './routes/user.routes'

const app = express()
database.connect()

const corsOptions: CorsOptions = {
  origin: env.NODE_ENV === 'production' ? env.WEBSITE_URL : true,
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

app.get('/ping', (req, res) => {
  res.send('Hello world')
})

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

server.listen(env.PORT, () => {
  console.log(`Server is running on port ${env.PORT}`)
})
