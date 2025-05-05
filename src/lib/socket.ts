import type { Server as HttpServer } from 'http'
import status from 'http-status'
import { Server } from 'socket.io'
import { env } from '~/config/env'
import { USER_VERIFY_STATUS } from '~/constants/enums'
import SOCKET_EVENTS from '~/constants/socket-events'
import { AppError } from '~/models/error.model'
import jwtService from '~/services/jwt.service'
import { TokenPayload } from '~/types/payload.type'

const initSocket = async (server: HttpServer) => {
  const io = new Server(server, {
    cors: {
      origin: 'http://localhost:3000',
      methods: ['POST', 'GET']
    }
  })

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

  io.use(async (socket, next) => {
    try {
      console.log(socket.handshake.auth)
      const { Authorization } = socket.handshake.auth
      const accessToken = Authorization?.split(' ')[1]
      const decodedAccessToken = await jwtService.verifyToken({
        token: accessToken,
        secretOrPublicKey: env.JWT_ACCESS_TOKEN_PRIVATE_KEY
      })
      const { verify } = decodedAccessToken
      if (verify !== USER_VERIFY_STATUS.VERIFIED) {
        throw new AppError({
          message: 'Account has not verified yet',
          status: status.FORBIDDEN
        })
      }

      socket.handshake.auth.decodedAccessToken = decodedAccessToken
      socket.handshake.auth.accessToken = accessToken
      next()
    } catch (error) {
      next({
        message: status[401],
        name: status['401_NAME'],
        data: error
      })
    }
  })

  io.on('connection', (socket) => {
    console.log(`user ${socket.id} connected`)
    const { userId } = socket.handshake.auth.decodedAccessToken as TokenPayload
    users.set(userId, socket.id)

    socket.use((event, next) => {
      try {
        console.log({ event })
        next()
      } catch (error) {
        next({
          message: status[401],
          name: status['401_NAME']
        })
      }
    })

    socket.on(SOCKET_EVENTS.SEND_MESSAGE, (data) => {
      console.log(data)
    })

    socket.on('error', (error) => {
      if (error.message === status['401_NAME']) {
        socket.disconnect()
      }
    })

    socket.on('disconnect', () => {
      users.delete(userId)
      console.log(`user ${socket.id} disconnected`)
    })
  })
}

export default initSocket
