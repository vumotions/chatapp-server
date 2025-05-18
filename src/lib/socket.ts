import type { Server as HttpServer } from 'http'
import status from 'http-status'
import { ObjectId, Schema, Types } from 'mongoose'
import { Server } from 'socket.io'
import { nanoid } from 'nanoid'
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

// Thêm hàm helper để gửi sự kiện socket
export const emitSocketEvent = (room: string, event: string, data: any) => {
  if (io) {
    try {
      console.log(`Emitting ${event} to room ${room}`, data)
      io.to(room).emit(event, data)
      return true
    } catch (error) {
      console.error(`Error emitting ${event} to room ${room}:`, error)
      return false
    }
  } else {
    console.error('Socket.io instance not available for emitting events')
    return false
  }
}

const initSocket = async (server: HttpServer) => {
  console.log('Creating Socket.io instance...')
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
    const { userId } = socket.handshake.auth.decodedAccessToken as TokenPayload

    // Lưu mapping userId -> socketId
    users.set(userId, socket.id)
    console.log('Current users:', Array.from(users.entries()))
    // Tham gia vào room cá nhân để nhận thông báo
    socket.join(userId)

    // Thêm log để kiểm tra các room
    console.log(`Socket ${socket.id} rooms:`, Array.from(socket.rooms))

    // Thông báo cho tất cả người dùng biết người dùng này đã online
    io.emit(SOCKET_EVENTS.USER_ONLINE, userId)
    console.log(`Broadcast user ${userId} is online`)

    // Xử lý sự kiện CHECK_ONLINE
    socket.on(SOCKET_EVENTS.CHECK_ONLINE, (checkUserId, callback) => {
      try {
        const isOnline = users.has(checkUserId)

        // Nếu người dùng đang online, trả về thời gian hiện tại
        if (isOnline) {
          callback(true, new Date().toISOString())
          return
        }

        // Lấy thời gian hoạt động gần nhất từ lastActiveMap
        const lastActive = lastActiveMap.get(checkUserId)

        // Nếu không có trong lastActiveMap (chưa từng online), trả về một giá trị đặc biệt
        if (!lastActive) {
          callback(false, 'never') // Sử dụng 'never' để đánh dấu chưa từng online
        } else {
          callback(false, lastActive)
        }
      } catch (error) {
        console.error('Error checking online status:', error)
        callback(false, null)
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

          finalChatId = chat._id instanceof Types.ObjectId ? chat._id.toString() : String(chat._id)
        } else {
          chat = await ChatModel.findById(chatId)
          if (!chat) {
            return socket.emit(SOCKET_EVENTS.ERROR, { message: 'Chat not found' })
          }

          // Kiểm tra xem người dùng có bị cấm chat không
          const sender = chat.members.find(
            (member) => member.userId.toString() === userId.toString()
          )

          if (sender?.isMuted) {
            // Kiểm tra thời hạn cấm chat
            if (!sender.mutedUntil || new Date() < new Date(sender.mutedUntil)) {
              return socket.emit(SOCKET_EVENTS.ERROR, {
                message: sender.mutedUntil
                  ? `Bạn đã bị cấm chat đến ${new Date(sender.mutedUntil).toLocaleString()}`
                  : 'Bạn đã bị cấm chat trong nhóm này'
              })
            } else {
              // Nếu đã hết thời hạn cấm chat, tự động bỏ cấm
              await ChatModel.updateOne(
                { _id: chatId, 'members.userId': userId },
                { $set: { 'members.$.isMuted': false, 'members.$.mutedUntil': null } }
              )
            }
          }
        }

        // Thực hiện đồng thời việc lấy thông tin người dùng và tạo tin nhắn
        const [sender, message] = await Promise.all([
          UserModel.findById(userId).select('name username avatar').lean(),
          MessageModel.create({
            chatId: finalChatId,
            senderId: userId,
            content,
            attachments,
            type,
            status: MESSAGE_STATUS.SENT,
            readBy: [userId]
          })
        ])

        // Cập nhật chat
        chat.lastMessage = message._id as ObjectId
        chat.read = false
        chat.set('updatedAt', new Date())
        await chat.save()

        // Join room
        socket.join(finalChatId)

        // Chuẩn bị thông tin người gửi với cấu trúc nhất quán
        const senderInfo = {
          _id: userId,
          name: sender?.name || sender?.username || 'Người dùng',
          avatar: sender?.avatar || null
        }

        // Gửi tới tất cả user trong room với đầy đủ thông tin người gửi
        io.to(finalChatId).emit(SOCKET_EVENTS.RECEIVE_MESSAGE, {
          ...message.toObject(),
          senderId: senderInfo, // Gửi senderId là một object chứa đầy đủ thông tin
          senderName: senderInfo.name, // Giữ lại để tương thích ngược
          senderAvatar: senderInfo.avatar // Giữ lại để tương thích ngược
        })

        // Tạo thông báo cho tất cả người tham gia trừ người gửi
        for (const participantId of chat.participants) {
          // Bỏ qua người gửi tin nhắn
          if (participantId.toString() === userId.toString()) continue

          // Tạo thông báo
          const notification = await NotificationModel.create({
            userId: participantId,
            senderId: userId,
            type: NOTIFICATION_TYPE.NEW_MESSAGE,
            relatedId: message._id,
            metadata: {
              chatId: finalChatId,
              chatName: chat.name || null,
              isGroup: chat.type === CHAT_TYPE.GROUP
            }
          })

          // Gửi thông báo qua socket
          const recipientSocketId = users.get(participantId.toString())
          if (recipientSocketId) {
            io.to(recipientSocketId).emit(SOCKET_EVENTS.NOTIFICATION_NEW, {
              ...notification.toObject(),
              sender: senderInfo // Sử dụng cùng cấu trúc dữ liệu cho người gửi
            })
          }
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

    socket.on('JOIN_ROOM', (roomId) => {
      console.log(`User ${socket.data.userId || socket.id} joining room: ${roomId}`)
      socket.join(roomId)
      console.log(`Rooms for socket ${socket.id}:`, Array.from(socket.rooms))

      // Thông báo cho các client khác trong room biết có người mới tham gia
      socket.to(roomId).emit('USER_JOINED', {
        userId: socket.data.userId,
        roomId
      })
    })

    socket.on('READY_FOR_MESSAGES', (roomId) => {
      console.log(
        `User ${socket.data.userId || socket.id} is ready for messages in room: ${roomId}`
      )
      // Có thể gửi lại tin nhắn gần nhất nếu cần
    })

    // Handle marking messages as read
    socket.on(SOCKET_EVENTS.MARK_AS_READ, async (data) => {
      try {
        const { chatId, messageIds } = data
        // Lấy userId từ socket.handshake.auth đã được set trong middleware
        const userId = socket.handshake.auth.userId

        if (!chatId || !messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
          return socket.emit(SOCKET_EVENTS.ERROR, {
            message: 'Invalid data for marking messages as read'
          })
        }

        console.log(`User ${userId} marking messages as read:`, { chatId, messageIds })

        // Lấy thông tin chat để kiểm tra loại chat
        const chat = await ChatModel.findById(chatId)
        if (!chat) {
          return socket.emit(SOCKET_EVENTS.ERROR, { message: 'Chat not found' })
        }

        // Lấy danh sách người tham gia
        const participants = chat.participants.map((p) => p.toString())

        // Cập nhật readBy cho các tin nhắn
        const messages = await MessageModel.find({ _id: { $in: messageIds } })
        const updatedMessages = []

        for (const message of messages) {
          // Chỉ cập nhật nếu người dùng chưa đọc tin nhắn
          if (!message.readBy.includes(userId)) {
            message.readBy.push(userId)

            // Đếm số người đã đọc tin nhắn (không tính người gửi)
            const readersCount = message.readBy.filter(
              (reader) => reader.toString() !== message.senderId.toString()
            ).length

            // Đếm số người nhận tin nhắn (không tính người gửi)
            const receiversCount = participants.filter(
              (p) => p !== message.senderId.toString()
            ).length

            console.log(`Message ${message._id}: ${readersCount}/${receiversCount} readers`)

            // Nếu tất cả người nhận đã đọc tin nhắn, đánh dấu là SEEN
            if (readersCount >= receiversCount) {
              message.status = MESSAGE_STATUS.SEEN
            } else {
              // Nếu chưa tất cả đã đọc, đánh dấu là DELIVERED
              message.status = MESSAGE_STATUS.DELIVERED
            }

            await message.save()
            updatedMessages.push(message)
          }
        }

        // Cập nhật trạng thái đã đọc của cuộc trò chuyện cho người dùng hiện tại
        await ChatModel.findOneAndUpdate({ _id: chatId, participants: userId }, { read: true })

        // Gửi thông báo đến tất cả người trong room
        io.to(chatId).emit(SOCKET_EVENTS.MESSAGE_READ, {
          chatId,
          messageIds,
          readBy: userId,
          messages: updatedMessages.map((msg) => ({
            _id: msg._id,
            status: msg.status,
            readBy: msg.readBy
          }))
        })

        console.log(`Emitted MESSAGE_READ event to room ${chatId}`)
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

          return reaction
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

    socket.on('TEST_DELETE_MESSAGE', (data) => {
      const { messageId, chatId } = data
      console.log(`Received TEST_DELETE_MESSAGE: ${messageId} in chat ${chatId}`)

      // Gửi sự kiện MESSAGE_DELETED đến tất cả clients
      io.emit('MESSAGE_DELETED', {
        messageId,
        chatId
      })

      // Gửi sự kiện đến room cụ thể
      io.to(chatId).emit('MESSAGE_DELETED', {
        messageId,
        chatId
      })

      console.log('Test MESSAGE_DELETED event emitted')
    })

    // Tối ưu hóa xử lý CHECK_NEW_MESSAGES
    socket.on('CHECK_NEW_MESSAGES', async (data) => {
      try {
        const { chatId, latestMessageId } = data
        console.log(`Checking for new messages in chat ${chatId} after message ${latestMessageId}`)

        // Tìm các tin nhắn mới hơn latestMessageId
        const newMessages = await MessageModel.find({
          chatId,
          _id: { $gt: latestMessageId }
        })
          .sort({ createdAt: -1 })
          .limit(10)
          .populate('senderId', 'name avatar')
          .setOptions({ strictPopulate: false })
          .lean()

        if (newMessages.length > 0) {
          console.log(`Found ${newMessages.length} new messages to sync`)

          // Gửi tin nhắn mới cho client
          socket.emit('SYNC_MESSAGES', {
            messages: newMessages,
            chatId
          })
        } else {
          console.log('No new messages to sync')
        }
      } catch (error) {
        console.error('Error checking for new messages:', error)
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
      const currentTime = new Date().toISOString()
      lastActiveMap.set(userId, currentTime)

      // Xóa khỏi danh sách users online
      users.delete(userId)

      console.log(`User ${userId} disconnected at ${currentTime}`)
      console.log('Remaining online users:', Array.from(users.entries()))

      // Thông báo cho tất cả người dùng biết người dùng này đã offline
      io.emit(SOCKET_EVENTS.USER_OFFLINE, userId, lastActiveMap.get(userId))
      console.log(`Broadcast user ${userId} is offline`)
    })

    // Thêm xử lý sự kiện xóa tin nhắn
    socket.on(SOCKET_EVENTS.DELETE_MESSAGE, async (data) => {
      try {
        const { messageId } = data
        const userId = socket.handshake.auth.decodedAccessToken.userId

        // Tìm tin nhắn
        const message = await MessageModel.findById(messageId)
        if (!message) {
          return socket.emit(SOCKET_EVENTS.ERROR, { message: 'Message not found' })
        }

        const chatId = message.chatId.toString()

        // Xóa tin nhắn
        await MessageModel.findByIdAndDelete(messageId)

        // Cập nhật lastMessage nếu cần
        const chat = await ChatModel.findById(chatId)
        if (chat && chat.lastMessage && chat.lastMessage.toString() === messageId) {
          const lastMessage = await MessageModel.findOne({ chatId })
            .sort({ createdAt: -1 })
            .limit(1)

          chat.lastMessage = lastMessage ? (lastMessage._id as Schema.Types.ObjectId) : undefined
          await chat.save()
        }

        // Phát sóng sự kiện MESSAGE_DELETED đến tất cả người dùng trong chat
        io.to(chatId).emit(SOCKET_EVENTS.MESSAGE_DELETED, {
          messageId,
          chatId
        })
      } catch (error) {
        console.error('DELETE_MESSAGE error:', error)
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Xóa tin nhắn thất bại' })
      }
    })
  })

  return io // Đảm bảo trả về đối tượng io
}

export default initSocket
