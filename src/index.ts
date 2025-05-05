import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import http from 'http'
import path from 'path'
import { env } from './config/env'
import database from './lib/database'
import initSocket from './lib/socket'
import defaultErrorHandler from './middlewares/error.middleware'
import authRoutes from './routes/auth.routes'
import postsRoutes from './routes/posts.routes'
import userRoutes from './routes/user.routes'
import conversationsRoutes from './routes/conversations.routes'

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
app.use('/api/posts', postsRoutes)

app.use(defaultErrorHandler)

const server = http.createServer(app)
initSocket(server)

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
})
