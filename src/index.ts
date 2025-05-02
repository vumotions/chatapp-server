import cors from 'cors'
import express, { NextFunction, Request, Response } from 'express'
import helmet from 'helmet'
import http from 'http'
import path from 'path'
import z from 'zod'
import { env } from './config/env'
import validate from './helpers/validation'
import database from './lib/database'
import initSocket from './lib/socket'
import defaultErrorHandler from './middlewares/error.middleware'
import { TransformContext } from './models/transform-context.model'
import authRoutes from './routes/auth.routes'
import postsRoutes from './routes/posts.routes'
import { accessTokenValidator } from './middlewares/auth.middleware'

const port = env.PORT

const app = express()
database.connect()

app.use(express.static(path.join(__dirname, 'public')))
app.use(express.json())
app.use(helmet())
app.use(cors())

app.use('/api/auth', authRoutes)
app.use('/api/posts', postsRoutes)

app.get('/api/test', accessTokenValidator, (req: Request, res: Response, next: NextFunction) => {
  res.json(req.context)
})
app.use(defaultErrorHandler)

const server = http.createServer(app)
initSocket(server)

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
})
