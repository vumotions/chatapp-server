import type { Server as HttpServer } from 'http'
import { ObjectId, Schema, Types } from 'mongoose'
import { Server } from 'socket.io'
import { env } from '~/config/env'
import {
  CHAT_TYPE,
  MESSAGE_STATUS,
  MESSAGE_TYPE,
  NOTIFICATION_TYPE,
  USER_VERIFY_STATUS
} from '~/constants/enums'
import SOCKET_EVENTS from '~/constants/socket-events'
import ChatModel from '~/models/chat.model'
import { AppError } from '~/models/error.model'
import MessageModel from '~/models/message.model'
import NotificationModel from '~/models/notification.model'
import SettingsModel from '~/models/settings.model'
import UserModel from '~/models/User.model'
import jwtService from '~/services/jwt.service'
import { TokenPayload } from '~/types/payload.type'
import { checkUserCanSendMessage } from './socket-helpers'

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
      origin: env.WEBSITE_URL,
      methods: ['POST', 'GET'],
      credentials: true
    },
    addTrailingSlash: false,
    path: '/socket.io',
    transports: ['websocket', 'polling']
  })

  io.use(async (socket, next) => {
    try {
      console.log('Socket auth:', socket.handshake.auth)
      const { Authorization } = socket.handshake.auth
      const accessToken = Authorization?.split(' ')[1]

      if (!accessToken) {
        throw new AppError({
          message: 'Missing access token',
          status: 401 // UNAUTHORIZED
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
          status: 403 // FORBIDDEN
        })
      }

      socket.handshake.auth.decodedAccessToken = decodedAccessToken
      socket.handshake.auth.accessToken = accessToken
      socket.handshake.auth.userId = userId

      next()
    } catch (error) {
      console.error('Socket authentication error:', error)
      next({
        message: 'Unauthorized', // status[401]
        name: 'Unauthorized', // status['401_NAME']
        data: error
      })
    }
  })

  io.on('connection', (socket) => {
    const { userId } = socket.handshake.auth.decodedAccessToken as TokenPayload

    // Middleware kiểm tra người dùng bị chặn
    socket.use(async ([event, data], next) => {
      // Chỉ kiểm tra cho các sự kiện liên quan đến chat
      if (event === SOCKET_EVENTS.SEND_MESSAGE || event === SOCKET_EVENTS.TYPING) {
        try {
          const chatId = data?.chatId

          if (!chatId) {
            return next()
          }

          // Tìm cuộc trò chuyện
          const chat = await ChatModel.findById(chatId)
          if (!chat) {
            return next(new Error('Không tìm thấy cuộc trò chuyện'))
          }

          // Nếu không phải chat 1-1, không cần kiểm tra chặn
          if (chat.type !== CHAT_TYPE.PRIVATE) {
            return next()
          }

          // Tìm ID người dùng khác trong cuộc trò chuyện
          const otherUserId = chat.participants.find((p) => p.toString() !== userId)?.toString()
          if (!otherUserId) {
            return next()
          }

          // Kiểm tra xem người dùng hiện tại có bị chặn bởi người dùng kia không
          const otherUserSettings = await SettingsModel.findOne({ userId: otherUserId })
          if (
            otherUserSettings &&
            otherUserSettings.security.blockedUsers &&
            otherUserSettings.security.blockedUsers.some((id: any) => id.toString() === userId)
          ) {
            return next(new Error('USER_BLOCKED'))
          }

          // Kiểm tra xem người dùng hiện tại có chặn người dùng kia không
          const currentUserSettings = await SettingsModel.findOne({ userId })
          if (
            currentUserSettings &&
            currentUserSettings.security.blockedUsers &&
            currentUserSettings.security.blockedUsers.some(
              (id: any) => id.toString() === otherUserId
            )
          ) {
            return next(new Error('USER_BLOCKING'))
          }

          next()
        } catch (error: any) {
          console.error('Error in block check middleware:', error)
          next(error)
        }
      } else {
        next()
      }
    })

    // Xử lý lỗi từ middleware
    socket.on('error', (err) => {
      console.error('Socket middleware error:', err)
      if (err.message === 'USER_BLOCKED') {
        socket.emit(SOCKET_EVENTS.ERROR, {
          message: 'Bạn không thể gửi tin nhắn vì đã bị người dùng này chặn',
          code: 'USER_BLOCKED'
        })
      } else if (err.message === 'USER_BLOCKING') {
        socket.emit(SOCKET_EVENTS.ERROR, {
          message: 'Bạn không thể gửi tin nhắn vì đã chặn người dùng này',
          code: 'USER_BLOCKING'
        })
      }
    })

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

    // Xử lý sự kiện JOIN_POST_ROOM - khi người dùng xem một bài viết
    socket.on('JOIN_POST_ROOM', (postId) => {
      const roomName = `post:${postId}`
      socket.join(roomName)
      console.log(`User ${socket.id} joined post room: ${roomName}`)
    })

    // Xử lý sự kiện JOIN_COMMENT_ROOM - khi người dùng xem replies của một comment
    socket.on('JOIN_COMMENT_ROOM', (commentId) => {
      if (!commentId) return

      const roomName = `comment:${commentId}`
      socket.join(roomName)
      console.log(`User ${userId} joined room ${roomName}`)
    })

    // Xử lý sự kiện LEAVE_POST_ROOM - khi người dùng rời khỏi trang bài viết
    socket.on('LEAVE_POST_ROOM', (postId) => {
      const roomName = `post:${postId}`
      socket.leave(roomName)
      console.log(`User ${socket.id} left post room: ${roomName}`)
    })

    // Xử lý sự kiện LEAVE_COMMENT_ROOM - khi người dùng đóng phần replies
    socket.on('LEAVE_COMMENT_ROOM', (commentId) => {
      if (!commentId) return

      const roomName = `comment:${commentId}`
      socket.leave(roomName)
      console.log(`User ${userId} left room ${roomName}`)
    })

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
    socket.on(SOCKET_EVENTS.SEND_MESSAGE, async (data: any) => {
      console.log({ data })
      try {
        const { chatId, content, attachments, type, participants, chatType, tempId } = data

        // Kiểm tra quyền gửi tin nhắn
        const canSendMessage = await checkUserCanSendMessage(socket, chatId)
        if (!canSendMessage) {
          return
        }
        // Tiếp tục logic gửi tin nhắn hiện tại
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
            readBy: [userId],
            tempId // Lưu tempId để client có thể theo dõi
          })
        ])
        console.log({ message })
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
          senderId: userId.toString(), // Gửi senderId dưới dạng string
          senderInfo: senderInfo, // Gửi thông tin người gửi dưới dạng object riêng biệt
          senderName: senderInfo.name,
          senderAvatar: senderInfo.avatar
        })
        console.log({
          ...message.toObject(),
          senderId: userId.toString(), // Gửi senderId dưới dạng string
          senderInfo: senderInfo, // Gửi thông tin người gửi dưới dạng object riêng biệt
          senderName: senderInfo.name,
          senderAvatar: senderInfo.avatar
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
            
            // THÊM DÒNG NÀY: Loại bỏ ID trùng lặp trong readBy
            message.readBy = [...new Set(message.readBy)]

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
          readBy: userId.toString(), // Đảm bảo là string
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
      if (error.message === 'Unauthorized') {
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

          // Thêm đoạn này để thông báo cập nhật lastMessage
          if (lastMessage) {
            // Populate thông tin người gửi để client hiển thị đúng
            const populatedMessage = await MessageModel.findById(lastMessage._id)
              .populate('senderId', 'name avatar username')
              .lean()

            io.to(chatId).emit('LAST_MESSAGE_UPDATED', {
              chatId,
              lastMessage: populatedMessage
            })
          }
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

    // Thêm xử lý các sự kiện liên quan đến cuộc gọi
    socket.on(SOCKET_EVENTS.INITIATE_CALL, async (data) => {
      try {
        const { recipientId, chatId, callType } = data
        console.log(
          `User ${userId} initiating ${callType} call to ${recipientId} in chat ${chatId}`
        )

        // Lấy thông tin người gọi từ database
        const caller = await UserModel.findById(userId).select('name avatar username').lean()

        const callerName = caller?.name || caller?.username || 'Unknown User'
        const callerAvatar = caller?.avatar || ''

        const recipientSocketId = users.get(recipientId)
        if (recipientSocketId) {
          // Gửi thông báo cuộc gọi đến cho người nhận với đầy đủ thông tin người gọi
          io.to(recipientSocketId).emit(SOCKET_EVENTS.INCOMING_CALL, {
            callerId: userId,
            callerName: callerName,
            callerAvatar: callerAvatar,
            chatId,
            callType
          })
        } else {
          // Người nhận không online, gửi thông báo cuộc gọi nhỡ
          socket.emit(SOCKET_EVENTS.CALL_MISSED, {
            recipientId,
            chatId,
            reason: 'RECIPIENT_OFFLINE'
          })
        }
      } catch (error) {
        console.error('Error handling INITIATE_CALL:', error)
      }
    })

    socket.on(SOCKET_EVENTS.SDP_OFFER, (data) => {
      try {
        const { sdp, recipientId, chatId, callType } = data
        console.log(`Forwarding SDP offer from ${userId} to ${recipientId}`)

        const recipientSocketId = users.get(recipientId)
        if (recipientSocketId) {
          io.to(recipientSocketId).emit(SOCKET_EVENTS.SDP_OFFER, {
            sdp,
            callerId: userId,
            chatId,
            callType
          })
        }
      } catch (error) {
        console.error('Error handling SDP_OFFER:', error)
      }
    })

    socket.on(SOCKET_EVENTS.SDP_ANSWER, (data) => {
      try {
        const { sdp, recipientId, chatId } = data
        console.log(`Forwarding SDP answer from ${userId} to ${recipientId}`)

        const recipientSocketId = users.get(recipientId)
        if (recipientSocketId) {
          io.to(recipientSocketId).emit(SOCKET_EVENTS.SDP_ANSWER, {
            sdp,
            callerId: userId,
            chatId
          })
        }
      } catch (error) {
        console.error('Error handling SDP_ANSWER:', error)
      }
    })

    socket.on(SOCKET_EVENTS.ICE_CANDIDATE, (data) => {
      try {
        const { candidate, recipientId, chatId } = data
        console.log(`Forwarding ICE candidate from ${userId} to ${recipientId}`)

        const recipientSocketId = users.get(recipientId)
        if (recipientSocketId) {
          io.to(recipientSocketId).emit(SOCKET_EVENTS.ICE_CANDIDATE, {
            candidate,
            callerId: userId,
            chatId
          })
        }
      } catch (error) {
        console.error('Error handling ICE_CANDIDATE:', error)
      }
    })

    socket.on(SOCKET_EVENTS.CALL_ACCEPTED, (data) => {
      try {
        const { callerId, chatId } = data
        console.log(`User ${userId} accepted call from ${callerId} in chat ${chatId}`)

        const callerSocketId = users.get(callerId)
        if (callerSocketId) {
          io.to(callerSocketId).emit(SOCKET_EVENTS.CALL_ACCEPTED, {
            recipientId: userId,
            chatId
          })
        }
      } catch (error) {
        console.error('Error handling CALL_ACCEPTED:', error)
      }
    })

    socket.on(SOCKET_EVENTS.CALL_REJECTED, (data) => {
      try {
        const { callerId, chatId } = data
        console.log(`User ${userId} rejected call from ${callerId} in chat ${chatId}`)

        const callerSocketId = users.get(callerId)
        if (callerSocketId) {
          io.to(callerSocketId).emit(SOCKET_EVENTS.CALL_REJECTED, {
            recipientId: userId,
            chatId
          })
        }
      } catch (error) {
        console.error('Error handling CALL_REJECTED:', error)
      }
    })

    socket.on(SOCKET_EVENTS.CALL_ENDED, async (data) => {
      try {
        const { recipientId, chatId, callType, createSystemMessage } = data
        console.log(`User ${userId} ended call with ${recipientId} in chat ${chatId}`)

        // Send call ended event to recipient
        const recipientSocketId = users.get(recipientId)
        if (recipientSocketId) {
          io.to(recipientSocketId).emit(SOCKET_EVENTS.CALL_ENDED, {
            callerId: userId,
            chatId
          })
        }

        // Create system message if requested
        if (createSystemMessage) {
          // Get chat and user info
          const [chat, user] = await Promise.all([
            ChatModel.findById(chatId),
            UserModel.findById(userId).select('name username avatar').lean()
          ])

          if (!chat) {
            console.error(`Chat ${chatId} not found`)
            return
          }

          // Create appropriate message based on call type
          const callTypeText = callType === 'VIDEO' ? 'cuộc gọi video' : 'cuộc gọi thoại'
          const userName = user?.name || user?.username || 'Người dùng'

          // Create system message
          const systemMessage = await MessageModel.create({
            chatId,
            senderId: userId,
            content: `${userName} đã kết thúc ${callTypeText}`,
            type: MESSAGE_TYPE.SYSTEM,
            status: MESSAGE_STATUS.DELIVERED
          })

          // Update chat's lastMessage
          chat.lastMessage = systemMessage._id as unknown as Schema.Types.ObjectId
          await chat.save()

          // Emit message to all users in the chat - using RECEIVE_MESSAGE event
          io.to(chatId).emit(SOCKET_EVENTS.RECEIVE_MESSAGE, {
            ...systemMessage.toObject(),
            senderId: userId.toString(),
            senderInfo: {
              _id: userId,
              name: userName,
              avatar: user?.avatar
            },
            senderName: userName,
            senderAvatar: user?.avatar
          })
        }
      } catch (error) {
        console.error('Error handling CALL_ENDED:', error)
      }
    })

    socket.on(SOCKET_EVENTS.TOGGLE_AUDIO, (data) => {
      try {
        const { recipientId, chatId, isMuted } = data
        console.log(`User ${userId} toggled audio (muted: ${isMuted}) in call with ${recipientId}`)

        const recipientSocketId = users.get(recipientId)
        if (recipientSocketId) {
          io.to(recipientSocketId).emit(SOCKET_EVENTS.TOGGLE_AUDIO, {
            callerId: userId,
            chatId,
            isMuted
          })
        }
      } catch (error) {
        console.error('Error handling TOGGLE_AUDIO:', error)
      }
    })

    socket.on(SOCKET_EVENTS.TOGGLE_VIDEO, (data) => {
      try {
        const { recipientId, chatId, isCameraOff } = data
        console.log(
          `User ${userId} toggled video (camera off: ${isCameraOff}) in call with ${recipientId}`
        )

        const recipientSocketId = users.get(recipientId)
        if (recipientSocketId) {
          io.to(recipientSocketId).emit(SOCKET_EVENTS.TOGGLE_VIDEO, {
            callerId: userId,
            chatId,
            isCameraOff
          })
        }
      } catch (error) {
        console.error('Error handling TOGGLE_VIDEO:', error)
      }
    })

    // Xử lý cuộc gọi nhỡ
    socket.on(SOCKET_EVENTS.CALL_MISSED, async (data) => {
      try {
        const { recipientId, chatId, callType } = data
        console.log(`Call from ${userId} to ${recipientId} in chat ${chatId} was missed`)

        // Lấy thông tin người gọi và chat
        const [caller, chat] = await Promise.all([
          UserModel.findById(userId).select('name username avatar').lean(),
          ChatModel.findById(chatId)
        ])

        if (!chat) {
          console.error(`Chat ${chatId} not found`)
          return
        }

        const callerName = caller?.name || caller?.username || 'Người dùng'

        // Tạo tin nhắn hệ thống
        const callTypeText = callType === 'VIDEO' ? 'cuộc gọi video' : 'cuộc gọi thoại'
        const systemMessage = await MessageModel.create({
          chatId,
          senderId: userId,
          content: `${callerName} đã gọi ${callTypeText} (cuộc gọi nhỡ)`,
          type: MESSAGE_TYPE.SYSTEM,
          status: MESSAGE_STATUS.DELIVERED
        })

        console.log('Created missed call system message:', systemMessage._id)

        // Cập nhật lastMessage của chat
        chat.lastMessage = systemMessage._id as unknown as Schema.Types.ObjectId
        await chat.save()

        // Gửi tin nhắn hệ thống đến tất cả người dùng trong chat
        io.to(chatId).emit(SOCKET_EVENTS.RECEIVE_MESSAGE, {
          ...systemMessage.toObject(),
          senderId: userId.toString(),
          senderInfo: {
            _id: userId,
            name: callerName,
            avatar: caller?.avatar
          },
          senderName: callerName,
          senderAvatar: caller?.avatar
        })

        // Gửi sự kiện CALL_MISSED đến người nhận để đóng cuộc gọi
        const recipientSocketId = users.get(recipientId)
        if (recipientSocketId) {
          io.to(recipientSocketId).emit(SOCKET_EVENTS.CALL_MISSED, {
            chatId,
            recipientId
          })
          console.log(`Sent CALL_MISSED event to recipient ${recipientId}`)
        }

        console.log('Missed call system message sent to room:', chatId)
      } catch (error) {
        console.error('Error handling CALL_MISSED:', error)
        socket.emit(SOCKET_EVENTS.ERROR, { message: 'Xử lý cuộc gọi nhỡ thất bại' })
      }
    })
  })

  return io // Đảm bảo trả về đối tượng io
}

export default initSocket
