import type { Server as HttpServer } from 'http'
import { Server } from 'socket.io'

const initSocket = async (server: HttpServer) => {
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
}

export default initSocket
