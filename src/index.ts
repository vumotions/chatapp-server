import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import http from 'http'
import database from './lib/database'
import initSocket from './lib/socket'
import defaultErrorHandler from './middlewares/global.middleware'
import authRoutes from './routes/user.routes'

// Connect to database
database.connect()

const port = process.env.PORT || 4000

const app = express()
app.use(express.json())
app.use(helmet())
app.use(cors())

const server = http.createServer(app)

app.use('/auth', authRoutes)
app.use(defaultErrorHandler)

initSocket(server)

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
})
