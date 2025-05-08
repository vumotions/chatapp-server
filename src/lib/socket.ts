import type { Server as HttpServer } from 'http'
import status from 'http-status'
import { ObjectId, Schema, Types } from 'mongoose'
import { Server } from 'socket.io'
import { env } from '~/config/env'
import { CHAT_TYPE, MESSAGE_STATUS, NOTIFICATION_TYPE, USER_VERIFY_STATUS } from '~/constants/enums'
import SOCKET_EVENTS from '~/constants/socket-events'
import ChatModel from '~/models/chat.model'
import { AppError } from '~/models/error.model'
import MessageModel from '~/models/message.model'
import NotificationModel from '~/models/notification.model'
import UserModel from '~/models/user.model'
import jwtService from '~/services/jwt.service'
import { TokenPayload } from '~/types/payload.type'

export let io: Server
// Lưu trữ mapping giữa userId và socketId
export const users = new Map<string, string>()
// Thêm Map để lưu trữ thời gian hoạt động gần nhất của người dùng
export const lastActiveMap = new Map<string, string>()

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

    // Cập nhật trạng thái online và thông báo cho tất cả người dùng
    io.emit(SOCKET_EVENTS.USER_ONLINE, userId)

    // Tham gia vào room cá nhân để nhận thông báo
    socket.join(userId)
    console.log(`User ${userId} joined personal room`)

    // Xử lý sự kiện CHECK_ONLINE
    socket.on(SOCKET_EVENTS.CHECK_ONLINE, (checkUserId, callback) => {
      try {
        const isOnline = users.has(checkUserId)
        const lastActive = lastActiveMap.get(checkUserId) || new Date().toISOString()
        callback(isOnline, lastActive)
      } catch (error) {
        console.error('Error checking online status:', error)
        callback(false, new Date().toISOString())
      }
    })

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
    socket.on(SOCKET_EVENTS.TYPING, async (data: { chatId: string; isTyping?: boolean }) => {
      try {
        const chat = await ChatModel.findById(data.chatId)
        if (!chat) return

        const userId = socket.handshake.auth.decodedAccessToken.userId
        const isTyping = data.isTyping !== false // Mặc định là true nếu không được chỉ định

        // Emit typing event to all participants except sender
        chat.participants.forEach((participant) => {
          if (participant.toString() !== userId) {
            const participantSocket = users.get(participant.toString())
            if (participantSocket) {
              // Gửi sự kiện typing start hoặc stop tùy thuộc vào trạng thái
              const eventName = isTyping ? SOCKET_EVENTS.TYPING_START : SOCKET_EVENTS.TYPING_STOP
              io.to(participantSocket).emit(eventName, {
                userId,
                chatId: data.chatId
              })
            }
          }
        })
      } catch (error) {
        console.error('Error handling typing event:', error)
      }
    })

    socket.on('JOIN_ROOM', (data: { chatId: string }) => {
      try {
        const { chatId } = data
        console.log(`User ${userId} joining room ${chatId}`)
        socket.join(chatId)
      } catch (error) {
        console.error('Error joining room:', error)
      }
    })

    // Handle marking messages as read
    socket.on(SOCKET_EVENTS.MARK_AS_READ, async (data) => {
      try {
        const { chatId, messageIds } = data

        if (!chatId || !messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
          return socket.emit(SOCKET_EVENTS.ERROR, {
            message: 'Invalid data for marking messages as read'
          })
        }

        // Cập nhật trạng thái tin nhắn trong database
        await MessageModel.updateMany(
          { _id: { $in: messageIds }, chatId },
          { $set: { status: MESSAGE_STATUS.SEEN } }
        )

        // Lấy thông tin về chat để biết người gửi tin nhắn
        const chat = await ChatModel.findById(chatId)
        if (!chat) {
          return socket.emit(SOCKET_EVENTS.ERROR, { message: 'Chat not found' })
        }

        // Lấy thông tin về các tin nhắn để biết người gửi
        const messages = await MessageModel.find({ _id: { $in: messageIds } })

        // Nhóm tin nhắn theo người gửi
        const messagesBySender = messages.reduce(
          (acc, message) => {
            const senderId = message.senderId.toString()
            if (!acc[senderId]) {
              acc[senderId] = []
            }
            acc[senderId].push(
              typeof message._id === 'object' && message._id !== null && 'toString' in message._id
                ? message._id.toString()
                : String(message._id)
            )
            return acc
          },
          {} as Record<string, string[]>
        )

        // Gửi thông báo đến từng người gửi
        for (const [senderId, senderMessageIds] of Object.entries(messagesBySender)) {
          // Chỉ gửi thông báo nếu người gửi không phải là người đang đọc
          if (senderId !== userId) {
            const senderSocketId = users.get(senderId)
            if (senderSocketId) {
              io.to(senderSocketId).emit(SOCKET_EVENTS.MESSAGE_READ, {
                chatId,
                messageIds: senderMessageIds,
                readBy: userId
              })
            }
          }
        }

        // Gửi thông báo đến tất cả người trong room
        io.to(chatId).emit(SOCKET_EVENTS.MESSAGE_READ, {
          chatId,
          messageIds,
          readBy: userId
        })
      } catch (error) {
        console.error('MARK_AS_READ error:', error)
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Đánh dấu tin nhắn đã đọc thất bại' })
      }
    })

    // Handle message reactions
    socket.on(SOCKET_EVENTS.ADD_REACTION, async (data) => {
      try {
        const { messageId, reactionType = '❤️' } = data

        if (!messageId) {
          return socket.emit(SOCKET_EVENTS.ERROR, {
            message: 'Invalid data for adding reaction'
          })
        }

        // Tìm tin nhắn
        const message = await MessageModel.findById(messageId)
        if (!message) {
          return socket.emit(SOCKET_EVENTS.ERROR, { message: 'Message not found' })
        }

        // Kiểm tra xem người dùng đã thả reaction chưa
        const existingReactionIndex =
          message.reactions?.findIndex((reaction) => reaction.userId.toString() === userId) ?? -1

        // Thêm log để debug
        console.log('Adding reaction:', {
          messageId,
          userId,
          reactionType,
          existingReactionIndex,
          hasReactions: !!message.reactions,
          reactionsLength: message.reactions?.length || 0
        })

        if (existingReactionIndex !== -1) {
          // Nếu đã có reaction, cập nhật loại reaction
          if (message.reactions) {
            message.reactions[existingReactionIndex].type = reactionType
          }
        } else {
          // Nếu chưa có, thêm reaction mới
          if (!message.reactions) {
            message.reactions = []
          }

          message.reactions.push({
            userId: new Types.ObjectId(userId) as any,
            type: reactionType,
            createdAt: new Date()
          })
        }

        // Lưu tin nhắn
        await message.save()

        // Lấy thông tin người dùng để gửi kèm
        const user = await UserModel.findById(userId, 'name avatar')

        // Chuẩn bị dữ liệu reactions để gửi
        const reactionsToSend = message.reactions?.map((reaction) => {
          if (reaction.userId.toString() === userId) {
            return {
              userId: {
                _id: userId,
                name: user?.name || 'User',
                avatar: user?.avatar || ''
              },
              type: reaction.type,
              createdAt: reaction.createdAt
            }
          }
          
          return reaction;
        })

        // Gửi thông báo đến tất cả người trong room
        io.to(message.chatId.toString()).emit(SOCKET_EVENTS.MESSAGE_REACTION_UPDATED, {
          messageId,
          reactions: reactionsToSend
        })

        // Thêm log thành công
        console.log('Reaction added successfully:', {
          messageId,
          reactionsCount: message.reactions?.length
        })
      } catch (error) {
        console.error('ADD_REACTION error:', error)
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Thêm reaction thất bại' })
      }
    })

    // Handle removing reactions
    socket.on(SOCKET_EVENTS.REMOVE_REACTION, async (data) => {
      try {
        const { messageId } = data

        if (!messageId) {
          return socket.emit(SOCKET_EVENTS.ERROR, {
            message: 'Invalid data for removing reaction'
          })
        }

        // Tìm tin nhắn
        const message = await MessageModel.findById(messageId)
        if (!message) {
          return socket.emit(SOCKET_EVENTS.ERROR, { message: 'Message not found' })
        }

        // Xóa reaction của người dùng
        if (message.reactions) {
          message.reactions = message.reactions.filter(
            (reaction) => reaction.userId.toString() !== userId
          )
        }

        // Lưu tin nhắn
        await message.save()

        // Gửi thông báo đến tất cả người trong room
        io.to(message.chatId.toString()).emit(SOCKET_EVENTS.MESSAGE_REACTION_UPDATED, {
          messageId,
          reactions: message.reactions || []
        })

        console.log('Reaction removed successfully:', {
          messageId,
          reactionsCount: message.reactions?.length || 0
        })
      } catch (error) {
        console.error('REMOVE_REACTION error:', error)
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Xóa reaction thất bại' })
      }
    })

    socket.on('error', (error) => {
      console.error('Socket error:', error)
      if (error.message === status['401_NAME']) {
        socket.disconnect()
      }
    })

    socket.on('disconnect', () => {
      // Lưu thời gian hoạt động gần nhất trước khi xóa khỏi danh sách online
      lastActiveMap.set(userId, new Date().toISOString())

      // Thông báo cho tất cả người dùng rằng người dùng này đã offline
      io.emit(SOCKET_EVENTS.USER_OFFLINE, userId, lastActiveMap.get(userId))

      users.delete(userId)
      console.log(`User ${socket.id} (${userId}) disconnected`)
      console.log('Remaining users:', Array.from(users.entries()))
    })
  })

  return io
}

export default initSocket
