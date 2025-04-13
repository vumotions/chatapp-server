import express, { Request, Response } from 'express'
import http from 'http'
import { Server } from 'socket.io'
import db from './utils/db'
import UserModel from './models/User.model'

// Connect to database
db.connect()
const app = express()
const port = process.env.PORT || 4000
app.use(express.json())

const server = http.createServer(app)
const io = new Server(server)

const users = new Map<string, string>()
const rooms = new Map<string, Set<string>>()
const calls = new Map<
  string,
  {
    host: string
    participants: Set<string>
    type: '1-1' | 'group'
  }
>()

io.on('connection', (socket) => {
  console.log('a user connected', { socket })
})

app.get('/', (req: Request, res: Response) => {
  res.send('Vu Motions Test!')
})

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
})
