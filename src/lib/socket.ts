import type { Server as HttpServer } from 'http'
import status from 'http-status'
import { ObjectId } from 'mongoose'
import { Server } from 'socket.io'
import { env } from '~/config/env'
import {
  CHAT_TYPE,
  FRIEND_REQUEST_STATUS,
  MESSAGE_STATUS,
  NOTIFICATION_TYPE,
  USER_VERIFY_STATUS
} from '~/constants/enums'
import SOCKET_EVENTS from '~/constants/socket-events'
import ChatModel from '~/models/chat.model'
import { AppError } from '~/models/error.model'
import FriendRequestModel from '~/models/friend-request.model'
import MessageModel from '~/models/message.model'
import NotificationModel from '~/models/notification.model'
import jwtService from '~/services/jwt.service'
import { TokenPayload } from '~/types/payload.type'

export let io: Server
// Lưu trữ mapping giữa userId và socketId
export const users = new Map<string, string>()

const initSocket = async (server: HttpServer) => {
  io = new Server(server, {
    cors: {
      origin: env.WEBSITE_URL || 'http://localhost:3000',
      methods: ['POST', 'GET']
    }
  })

  io.use(async (socket, next) => {
    try {
      console.log('Socket auth:', socket.handshake.auth)
      const { Authorization } = socket.handshake.auth
      const accessToken = Authorization?.split(' ')[1]

      if (!accessToken) {
        throw new AppError({
          message: 'Missing access token',
          status: status.UNAUTHORIZED
        })
      }

      const decodedAccessToken = await jwtService.verifyToken({
        token: accessToken,
        secretOrPublicKey: env.JWT_ACCESS_TOKEN_PRIVATE_KEY
      })

      const { verify, userId } = decodedAccessToken

      if (verify !== USER_VERIFY_STATUS.VERIFIED) {
        throw new AppError({
          message: 'Account has not verified yet',
          status: status.FORBIDDEN
        })
      }

      socket.handshake.auth.decodedAccessToken = decodedAccessToken
      socket.handshake.auth.accessToken = accessToken
      socket.handshake.auth.userId = userId

      next()
    } catch (error) {
      console.error('Socket authentication error:', error)
      next({
        message: status[401],
        name: status['401_NAME'],
        data: error
      })
    }
  })

  io.on('connection', (socket) => {
    console.log(`User ${socket.id} connected`)
    const { userId } = socket.handshake.auth.decodedAccessToken as TokenPayload

    // Lưu mapping userId -> socketId
    users.set(userId, socket.id)
    console.log(`User ${userId} mapped to socket ${socket.id}`)
    console.log('Current users:', Array.from(users.entries()))

    // Tham gia vào room cá nhân để nhận thông báo
    socket.join(userId)
    console.log(`User ${userId} joined personal room`)

    // Handle send message
    socket.on(SOCKET_EVENTS.SEND_MESSAGE, async (data) => {
      try {
        const { chatId, content, attachments, type, participants, chatType } = data
        let chat

        if (!content && (!attachments || attachments.length === 0)) {
          return socket.emit(SOCKET_EVENTS.ERROR, {
            message: 'Message must have content or attachments'
          })
        }

        let finalChatId = chatId

        if (!chatId) {
          const uniqueMembers = Array.from(new Set([...(participants || []), userId]))

          // Kiểm tra xem có phải chat private không
          if (chatType === CHAT_TYPE.PRIVATE && uniqueMembers.length === 2) {
            const otherUserId = uniqueMembers.find((id) => id !== userId)

            // Tìm conversation đã tồn tại
            chat = await ChatModel.findOne({
              type: CHAT_TYPE.PRIVATE,
              participants: { $all: uniqueMembers, $size: 2 }
            })

            // Nếu chưa có conversation, tạo mới
            if (!chat) {
              chat = await ChatModel.create({
                userId,
                type: CHAT_TYPE.PRIVATE,
                participants: uniqueMembers
              })
            }
          } else {
            // Tạo group chat
            chat = await ChatModel.create({
              userId,
              type: type || CHAT_TYPE.GROUP,
              participants: uniqueMembers
            })
          }

          finalChatId = chat._id.toString()
        } else {
          chat = await ChatModel.findById(chatId)
          if (!chat) {
            return socket.emit(SOCKET_EVENTS.ERROR, { message: 'Chat not found' })
          }
        }

        // Tạo message
        const message = await MessageModel.create({
          chatId: finalChatId,
          senderId: userId,
          content,
          attachments,
          type,
          status: MESSAGE_STATUS.SENT,
          readBy: [userId]
        })

        // Cập nhật chat
        chat.lastMessage = message._id as ObjectId
        chat.read = false // Đánh dấu là chưa đọc khi có tin nhắn mới
        await chat.save()

        // Join room
        socket.join(finalChatId)

        // Gửi tới tất cả user trong room
        io.to(finalChatId).emit(SOCKET_EVENTS.RECEIVE_MESSAGE, {
          ...message.toObject(),
          senderName: socket.handshake.auth.decodedAccessToken.name || 'User',
          senderAvatar: socket.handshake.auth.decodedAccessToken.avatar || null
        })

        // Tạo thông báo cho những người không online
        const onlineUsers = Array.from(users.keys())
        const offlineParticipants = chat.participants.filter(
          (participant: ObjectId) => !onlineUsers.includes(participant.toString())
        )

        for (const participantId of offlineParticipants) {
          const notification = await NotificationModel.create({
            userId: participantId,
            senderId: userId,
            type: NOTIFICATION_TYPE.NEW_MESSAGE,
            relatedId: message._id
          })
          
          // Thêm dòng này để gửi thông báo ngay cả khi người dùng online
          io.to(participantId.toString()).emit(SOCKET_EVENTS.NOTIFICATION_NEW, {
            ...notification.toObject(),
            sender: {
              _id: userId,
              name: socket.handshake.auth.decodedAccessToken.name,
              avatar: socket.handshake.auth.decodedAccessToken.avatar
            }
          })
        }
      } catch (error) {
        console.error('SEND_MESSAGE error:', error)
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Gửi tin nhắn thất bại' })
      }
    })

    // Handle typing events
    socket.on(SOCKET_EVENTS.TYPING, async (data: { chatId: string, isTyping?: boolean }) => {
      try {
        const chat = await ChatModel.findById(data.chatId);
        if (!chat) return;

        const userId = socket.handshake.auth.decodedAccessToken.userId;
        const isTyping = data.isTyping !== false; // Mặc định là true nếu không được chỉ định

        // Emit typing event to all participants except sender
        chat.participants.forEach((participant) => {
          if (participant.toString() !== userId) {
            const participantSocket = users.get(participant.toString());
            if (participantSocket) {
              // Gửi sự kiện typing start hoặc stop tùy thuộc vào trạng thái
              const eventName = isTyping ? SOCKET_EVENTS.TYPING_START : SOCKET_EVENTS.TYPING_STOP;
              io.to(participantSocket).emit(eventName, {
                userId,
                chatId: data.chatId
              });
            }
          }
        });
      } catch (error) {
        console.error('Error handling typing event:', error);
      }
    });

    socket.on('JOIN_ROOM', (data: { chatId: string }) => {
      try {
        const { chatId } = data;
        console.log(`User ${userId} joining room ${chatId}`);
        socket.join(chatId);
      } catch (error) {
        console.error('Error joining room:', error);
      }
    });

    socket.on('error', (error) => {
      console.error('Socket error:', error)
      if (error.message === status['401_NAME']) {
        socket.disconnect()
      }
    })

    socket.on('disconnect', () => {
      users.delete(userId)
      console.log(`User ${socket.id} (${userId}) disconnected`)
      console.log('Remaining users:', Array.from(users.entries()))
    })
  })

  return io
}

export default initSocket
