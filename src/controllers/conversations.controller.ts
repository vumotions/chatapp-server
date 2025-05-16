import { NextFunction, Request, Response } from 'express'
import status from 'http-status'
import mongoose, { Schema, Types } from 'mongoose'
import { nanoid } from 'nanoid'
import { env } from '~/config/env'
import {
  CHAT_TYPE,
  GROUP_TYPE,
  JOIN_REQUEST_STATUS,
  MEMBER_ROLE,
  MESSAGE_STATUS,
  MESSAGE_TYPE,
  NOTIFICATION_TYPE
} from '~/constants/enums'
import SOCKET_EVENTS from '~/constants/socket-events'
import { emitSocketEvent } from '~/lib/socket'
import ChatModel from '~/models/chat.model'
import { AppError } from '~/models/error.model'
import MessageModel from '~/models/message.model'
import NotificationModel from '~/models/notification.model'
import { AppSuccess } from '~/models/success.model'
import UserModel from '~/models/user.model'

class ConversationsController {
  async getUserConversations(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.context?.user?._id
      const page = parseInt(req.query?.page as string) || 1
      const limit = parseInt(req.query?.limit as string) || 10
      const filter = (req.query?.filter as string) || 'all' // 'all' hoặc 'unread'
      const searchQuery = ((req.query?.search as string) || '').trim()
      const skip = (page - 1) * limit

      // Kiểm tra userId
      if (!userId) {
        return next(
          new AppError({
            status: status.UNAUTHORIZED,
            message: 'User ID is required'
          })
        )
      }

      // Xây dựng query dựa trên filter
      const query: any = {
        participants: userId,
        archived: { $ne: true } // Chỉ lấy những chat KHÔNG được archive
        // Đã loại bỏ deletedFor
      }

      if (filter === 'unread') {
        query.read = false
        query.lastMessage = { $exists: true } // Chỉ lấy những chat có tin nhắn
      }

      // Tìm tất cả cuộc trò chuyện mà người dùng tham gia
      let conversations = await ChatModel.find(query)
        .populate({
          path: 'participants',
          select: 'name avatar' // Đảm bảo chọn cả avatar
        })
        .populate({
          path: 'lastMessage',
          populate: {
            path: 'senderId',
            select: 'name avatar' // Đảm bảo chọn cả avatar
          }
        })
        .sort({ updatedAt: -1 })
        .lean() // Convert to plain JavaScript objects

      console.log(`Found ${conversations.length} conversations before processing`)

      // Xử lý dữ liệu trước khi lọc
      const processedConversations = conversations.map((conv) => {
        const conversation = conv as any // Type assertion to avoid TypeScript errors

        // Đối với chat riêng tư, lấy thông tin của người còn lại
        if (
          conversation.type === 'PRIVATE' &&
          conversation.participants &&
          conversation.participants.length > 0
        ) {
          // Lọc ra những người tham gia khác với người dùng hiện tại
          const otherParticipants = conversation.participants.filter(
            (p: any) => p._id.toString() !== userId.toString()
          )

          // Lấy thông tin người đầu tiên trong danh sách
          const otherUser = otherParticipants[0]
          if (otherUser) {
            conversation.name = otherUser.name || 'Unknown User'
            conversation.avatar = otherUser.avatar || null
          }
        }

        return conversation
      })

      // Lọc kết quả theo searchQuery nếu có
      let filteredConversations = processedConversations
      if (searchQuery) {
        filteredConversations = processedConversations.filter((conv) => {
          // Tìm kiếm chính xác trong tên nhóm chat
          if (conv.name) {
            const nameMatch = conv.name.toLowerCase().includes(searchQuery.toLowerCase())
            if (nameMatch) return true
          }

          // Tìm kiếm chính xác trong tên người tham gia
          const participantMatch = conv.participants.some((participant: any) => {
            if (participant.name) {
              return participant.name.toLowerCase().includes(searchQuery.toLowerCase())
            }
            return false
          })

          return participantMatch
        })
      }

      // Kiểm tra lại một lần nữa để đảm bảo không có chat nào có archived=true
      filteredConversations = filteredConversations.filter((conv) => !conv.archived)
      console.log(`After final filtering: ${filteredConversations.length} conversations`)

      // Phân trang sau khi lọc
      const totalItems = filteredConversations.length
      const paginatedConversations = filteredConversations.slice(skip, skip + limit)

      // Trả về kết quả
      res.json(
        new AppSuccess({
          data: {
            conversations: paginatedConversations,
            hasMore: totalItems > skip + limit,
            total: totalItems
          },
          message: 'Get conversations successfully'
        })
      )
    } catch (error) {
      console.error('Error in getUserConversations:', error)
      next(error)
    }
  }

  async getMessagesByConversation(req: Request, res: Response, next: NextFunction) {
    const conversationId = req.params?.chatId
    const userId = req.context?.user?._id
    const page = parseInt(req.query?.page as string) || 1
    const limit = parseInt(req.query?.limit as string) || 10
    const skip = (page - 1) * limit

    console.log(
      `Fetching messages for conversation ${conversationId}, page ${page}, limit ${limit}`
    )

    // Nếu không có conversationId, trả về lỗi
    if (!conversationId) {
      next(
        new AppError({
          status: status.BAD_REQUEST,
          message: 'Conversation ID is required'
        })
      )
      return
    }

    // Kiểm tra tính hợp lệ của conversationId
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      next(
        new AppError({
          status: status.BAD_REQUEST,
          message: 'Invalid conversation ID'
        })
      )
      return
    }

    // Tìm conversation
    let conversation = await ChatModel.findById(conversationId)
      .populate('participants', 'name avatar username')
      .populate({
        path: 'lastMessage',
        populate: {
          path: 'senderId',
          select: 'name avatar username'
        }
      })

    // Lấy danh sách tin nhắn của conversation
    const messages = await MessageModel.find({ chatId: conversationId })
      .skip(skip)
      .limit(limit)
      .populate('senderId', 'name avatar username')
      .sort({ createdAt: -1 })

    // Kiểm tra xem còn dữ liệu phía sau không
    const totalMessages = await MessageModel.countDocuments({ chatId: conversationId })
    const hasMore = page * limit < totalMessages

    console.log(`Found ${messages.length} messages, total: ${totalMessages}, hasMore: ${hasMore}`)

    res.json(
      new AppSuccess({
        message: 'Get messages successfully',
        data: {
          conversation,
          messages,
          hasMore
        }
      })
    )
  }

  async createConversation(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.context?.user?._id
      const { participants } = req.body

      console.log('Creating conversation with participants:', participants)
      console.log('Current user:', userId)

      if (!userId) {
        return next(
          new AppError({
            status: status.UNAUTHORIZED,
            message: 'User ID is required'
          })
        )
      }

      if (!participants || !Array.isArray(participants) || participants.length === 0) {
        return next(
          new AppError({
            status: status.BAD_REQUEST,
            message: 'Participants are required'
          })
        )
      }

      // Kiểm tra đã có conversation chưa
      let conversation = await ChatModel.findOne({
        participants: { $all: [userId, ...participants], $size: participants.length + 1 },
        type: CHAT_TYPE.PRIVATE
      })

      console.log('Existing conversation:', conversation)

      if (!conversation) {
        // Tạo conversation mới
        conversation = await ChatModel.create({
          userId,
          participants: [userId, ...participants],
          type: CHAT_TYPE.PRIVATE,
          members: [
            {
              userId,
              role: MEMBER_ROLE.MEMBER,
              permissions: {},
              joinedAt: new Date()
            },
            ...participants.map((participantId) => ({
              userId: participantId,
              role: MEMBER_ROLE.MEMBER,
              permissions: {},
              joinedAt: new Date()
            }))
          ]
        })

        console.log('New conversation created:', conversation)
      }

      // Populate participants để trả về thông tin đầy đủ
      await conversation.populate('participants', 'name avatar')

      res.json(
        new AppSuccess({
          data: { conversation },
          message: 'Create new conversation successfully'
        })
      )
    } catch (error) {
      console.error('Create conversation error:', error)
      next(error)
    }
  }

  async markChatAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.context?.user?._id
      const { chatId } = req.params

      // Tìm cuộc trò chuyện
      const chat = await ChatModel.findById(chatId)
      if (!chat) {
        throw new AppError({ message: 'Không tìm thấy cuộc trò chuyện', status: 404 })
      }

      // Kiểm tra xem người dùng có trong cuộc trò chuyện không
      if (!chat.participants.some((id) => id.toString() === userId?.toString())) {
        throw new AppError({
          message: 'Bạn không có quyền truy cập cuộc trò chuyện này',
          status: 403
        })
      }

      // Đánh dấu cuộc trò chuyện là đã đọc
      chat.read = true
      await chat.save()

      // Đánh dấu tất cả tin nhắn trong cuộc trò chuyện là đã đọc
      // Chỉ đánh dấu tin nhắn của người khác gửi, không phải tin nhắn của chính mình
      await MessageModel.updateMany(
        {
          chatId,
          senderId: { $ne: userId }, // Không phải tin nhắn của người dùng hiện tại
          status: { $ne: MESSAGE_STATUS.SEEN } // Chưa được đánh dấu là đã đọc
        },
        { $set: { status: MESSAGE_STATUS.SEEN } }
      )

      // Emit sự kiện MESSAGE_READ để thông báo cho tất cả người dùng trong cuộc trò chuyện
      const io = req.app.get('io')
      if (io) {
        io.to(chatId).emit(SOCKET_EVENTS.MESSAGE_READ, {
          chatId,
          messageIds: [], // Không cần gửi messageIds cụ thể, chỉ cần chatId
          readBy: userId
        })
      }

      res.json(
        new AppSuccess({
          message: 'Đánh dấu cuộc trò chuyện là đã đọc thành công',
          data: { success: true }
        })
      )
    } catch (error) {
      next(error)
    }
  }

  // Thêm phương thức xóa tin nhắn
  async deleteMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const { messageId } = req.params
      const userId = req.context?.user?._id

      console.log('Deleting message:', messageId, 'by user:', userId)

      // Kiểm tra messageId
      if (!messageId) {
        return next(
          new AppError({
            status: status.BAD_REQUEST,
            message: 'Message ID is required'
          })
        )
      }

      // Tìm tin nhắn
      const message = await MessageModel.findById(messageId)
      console.log('Found message:', message)

      // Kiểm tra tin nhắn tồn tại
      if (!message) {
        return next(
          new AppError({
            status: status.NOT_FOUND,
            message: 'Message not found'
          })
        )
      }

      // Kiểm tra người dùng có quyền xóa tin nhắn không
      if (message.senderId.toString() !== userId?.toString()) {
        return next(
          new AppError({
            status: status.FORBIDDEN,
            message: 'You do not have permission to delete this message'
          })
        )
      }

      // Kiểm tra loại tin nhắn (chỉ cho phép xóa tin nhắn văn bản)
      if (message.type !== 'TEXT') {
        return next(
          new AppError({
            status: status.BAD_REQUEST,
            message: 'Only text messages can be deleted'
          })
        )
      }

      // Xóa tin nhắn
      await MessageModel.findByIdAndDelete(messageId)
      console.log('Message deleted successfully')

      // Cập nhật lastMessage của chat nếu tin nhắn bị xóa là tin nhắn cuối cùng
      const chat = await ChatModel.findById(message.chatId)
      console.log('Found chat:', chat?._id)

      if (chat && chat.lastMessage && chat.lastMessage.toString() === messageId) {
        console.log('Updating lastMessage for chat')
        // Tìm tin nhắn cuối cùng mới
        const lastMessage = await MessageModel.findOne({ chatId: message.chatId })
          .sort({ createdAt: -1 })
          .limit(1)

        // Cập nhật lastMessage
        chat.lastMessage = lastMessage
          ? (lastMessage._id as unknown as Schema.Types.ObjectId)
          : undefined
        await chat.save()
        console.log('Chat updated with new lastMessage:', lastMessage?._id)
      }

      // Thông báo cho tất cả người dùng trong chat
      const chatId = message.chatId.toString()
      const eventData = {
        messageId,
        chatId
      }

      // Sử dụng hàm helper để gửi sự kiện
      const emitted = emitSocketEvent(chatId, 'MESSAGE_DELETED', eventData)
      if (emitted) {
        console.log('MESSAGE_DELETED event emitted successfully')
      } else {
        console.error('Failed to emit MESSAGE_DELETED event')
      }

      res.json(
        new AppSuccess({
          data: { messageId },
          message: 'Message deleted successfully'
        })
      )
    } catch (error) {
      console.error('Error in deleteMessage:', error)
      next(error)
    }
  }

  // Thêm phương thức chỉnh sửa tin nhắn
  async editMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const { messageId } = req.params
      const { content } = req.body
      const userId = req.context?.user?._id

      console.log(`Editing message ${messageId} with content: ${content} by user ${userId}`)

      // Kiểm tra messageId và content
      if (!messageId) {
        return next(
          new AppError({
            status: status.BAD_REQUEST,
            message: 'Message ID is required'
          })
        )
      }

      if (!content || content.trim() === '') {
        return next(
          new AppError({
            status: status.BAD_REQUEST,
            message: 'Content is required'
          })
        )
      }

      // Tìm tin nhắn
      const message = await MessageModel.findById(messageId)

      // Kiểm tra tin nhắn tồn tại
      if (!message) {
        return next(
          new AppError({
            status: status.NOT_FOUND,
            message: 'Message not found'
          })
        )
      }

      // Kiểm tra người dùng có quyền chỉnh sửa tin nhắn không
      if (message.senderId.toString() !== userId?.toString()) {
        return next(
          new AppError({
            status: status.FORBIDDEN,
            message: 'You do not have permission to edit this message'
          })
        )
      }

      // Kiểm tra loại tin nhắn (chỉ cho phép chỉnh sửa tin nhắn văn bản)
      if (message.type !== 'TEXT') {
        return next(
          new AppError({
            status: status.BAD_REQUEST,
            message: 'Only text messages can be edited'
          })
        )
      }

      // Cập nhật nội dung tin nhắn
      message.content = content.trim()
      message.set('isEdited', true)
      await message.save()

      console.log('Message updated successfully:', message)

      // Thông báo cho tất cả người dùng trong chat
      const chatId = message.chatId.toString()
      const eventData = {
        messageId: message._id?.toString(),
        content: message.content,
        isEdited: true,
        chatId,
        updatedBy: userId?.toString()
      }

      console.log('Emitting MESSAGE_UPDATED event with data:', eventData)

      // Sử dụng hàm helper để gửi sự kiện
      const io = req.app.get('io')
      if (io) {
        io.to(chatId).emit('MESSAGE_UPDATED', eventData)
        console.log('MESSAGE_UPDATED event emitted successfully')
      } else {
        console.error('Socket.io instance not available')
      }

      res.json(
        new AppSuccess({
          data: message,
          message: 'Message updated successfully'
        })
      )
    } catch (error) {
      console.error('Error updating message:', error)
      next(error)
    }
  }

  // Thêm một endpoint test để kiểm tra socket
  async testSocket(req: Request, res: Response, next: NextFunction) {
    try {
      const { chatId, messageId } = req.body

      if (!chatId || !messageId) {
        return next(
          new AppError({
            status: status.BAD_REQUEST,
            message: 'Chat ID and Message ID are required'
          })
        )
      }

      console.log(
        `Testing socket: emitting MESSAGE_DELETED to room ${chatId} for message ${messageId}`
      )

      // Lấy đối tượng io từ app
      const io = req.app.get('io')

      if (io) {
        // Gửi sự kiện đến tất cả clients
        io.emit(SOCKET_EVENTS.MESSAGE_DELETED, {
          messageId,
          chatId
        })

        // Gửi sự kiện đến room cụ thể
        io.to(chatId).emit(SOCKET_EVENTS.MESSAGE_DELETED, {
          messageId,
          chatId
        })

        console.log('Test event emitted successfully')

        res.json(
          new AppSuccess({
            message: 'Test event emitted successfully',
            data: { chatId, messageId }
          })
        )
      } else {
        return next(
          new AppError({
            status: status.INTERNAL_SERVER_ERROR,
            message: 'Socket.io instance not available'
          })
        )
      }
    } catch (error) {
      console.error('Error in testSocket:', error)
      next(error)
    }
  }

  // Thêm phương thức xóa cuộc trò chuyện
  async deleteConversation(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.context?.user?._id
      const { conversationId } = req.params
      // Thêm tham số để xác định hành động là xóa hoàn toàn hay chỉ ẩn
      const { action = 'hide' } = req.query as { action?: 'hide' | 'delete' }

      if (!userId) {
        next(
          new AppError({
            status: status.UNAUTHORIZED,
            message: 'Unauthorized'
          })
        )
        return
      }

      const conversation = await ChatModel.findById(conversationId)
      if (!conversation) {
        next(
          new AppError({
            status: status.NOT_FOUND,
            message: 'Conversation not found'
          })
        )
        return
      }

      // Kiểm tra người dùng có trong cuộc trò chuyện không
      if (
        !conversation.participants.some(
          (participant) => participant.toString() === userId?.toString()
        )
      ) {
        next(
          new AppError({
            status: status.FORBIDDEN,
            message: 'You are not a participant in this conversation'
          })
        )
        return
      }

      // Kiểm tra xem người dùng có phải là admin/owner không
      const userMember = conversation.members?.find(
        (member) => member.userId.toString() === userId.toString()
      )

      const isOwner = userMember?.role === MEMBER_ROLE.OWNER

      // Nếu là nhóm chat và action là delete, chỉ owner mới có quyền xóa hoàn toàn
      if (conversation.type === CHAT_TYPE.GROUP && action === 'delete') {
        if (!isOwner) {
          next(
            new AppError({
              status: status.FORBIDDEN,
              message: 'Chỉ chủ nhóm mới có thể xóa hoàn toàn nhóm chat'
            })
          )
          return
        }

        // Xóa hoàn toàn nhóm chat
        await ChatModel.findByIdAndDelete(conversationId)
        await MessageModel.deleteMany({ chatId: conversationId })

        // Thông báo cho tất cả người dùng trong cuộc trò chuyện
        emitSocketEvent(conversationId.toString(), SOCKET_EVENTS.CONVERSATION_DELETED, {
          conversationId,
          deletedBy: userId
        })

        res.json(
          new AppSuccess({
            data: { conversationId },
            message: 'Nhóm đã được xóa hoàn toàn'
          })
        )
        return
      }

      // Nếu chỉ là ẩn cuộc trò chuyện (action = 'hide')
      if (conversation.type === CHAT_TYPE.GROUP) {
        // Đối với nhóm chat, chỉ ẩn cuộc trò chuyện khỏi danh sách của người dùng
        await ChatModel.findByIdAndUpdate(conversationId, {
          $addToSet: { hiddenFor: userId }
        })
      } else {
        // Đối với cuộc trò chuyện riêng tư
        const otherParticipants = conversation.participants.filter(
          (participant) => participant.toString() !== userId?.toString()
        )

        if (otherParticipants.length === 0) {
          // Nếu không còn ai, xóa hoàn toàn cuộc trò chuyện
          await ChatModel.findByIdAndDelete(conversationId)
          await MessageModel.deleteMany({ chatId: conversationId })
        } else {
          // Nếu còn người khác, chỉ ẩn cuộc trò chuyện khỏi danh sách của người dùng hiện tại
          await ChatModel.findByIdAndUpdate(conversationId, {
            $addToSet: { hiddenFor: userId }
          })
        }
      }

      res.json(
        new AppSuccess({
          data: { conversationId },
          message: 'Cuộc trò chuyện đã được ẩn khỏi danh sách của bạn'
        })
      )
    } catch (error) {
      console.error('Error in deleteConversation:', error)
      next(error)
    }
  }

  // Thêm phương thức để lấy thông tin cuộc trò chuyện theo ID
  async getConversationById(req: Request, res: Response, next: NextFunction) {
    try {
      console.log('getConversationById called with params:', req.params)
      const { conversationId } = req.params
      const userId = req.context?.user?._id

      // Kiểm tra conversationId
      if (!conversationId) {
        return next(
          new AppError({
            status: status.BAD_REQUEST,
            message: 'Conversation ID is required'
          })
        )
      }

      // Kiểm tra tính hợp lệ của conversationId
      if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        return next(
          new AppError({
            status: status.BAD_REQUEST,
            message: 'Invalid conversation ID'
          })
        )
      }

      // Tìm conversation
      const conversation = await ChatModel.findOne({
        _id: conversationId,
        participants: userId
      })
        .populate('participants', 'name avatar username')
        .populate({
          path: 'lastMessage',
          populate: {
            path: 'senderId',
            select: 'name avatar username'
          }
        })
        .populate('pendingRequests.userId', 'name avatar username') // Populate thông tin người dùng trong pendingRequests
        .populate('pendingRequests.invitedBy', 'name avatar username') // Populate thông tin người mời

      // Kiểm tra xem cuộc trò chuyện có tồn tại không
      if (!conversation) {
        return next(
          new AppError({
            status: status.NOT_FOUND,
            message: 'Conversation not found'
          })
        )
      }

      res.json(
        new AppSuccess({
          message: 'Get conversation successfully',
          data: conversation
        })
      )
    } catch (error) {
      console.error('Error in getConversationById:', error)
      next(error)
    }
  }

  // Thêm phương thức để lấy danh sách cuộc trò chuyện đã lưu trữ
  async getArchivedChats(req: Request, res: Response, next: NextFunction) {
    try {
      console.log('getArchivedChats called with query:', req.query)
      const userId = req.context?.user?._id
      const page = parseInt(req.query?.page as string) || 1
      const limit = parseInt(req.query?.limit as string) || 10
      const searchQuery = ((req.query?.search as string) || '').trim()
      const skip = (page - 1) * limit

      // Kiểm tra userId
      if (!userId) {
        return next(
          new AppError({
            status: status.UNAUTHORIZED,
            message: 'User ID is required'
          })
        )
      }

      // Xây dựng query cho archived chats
      const query: any = {
        participants: userId,
        archived: true
        // Đã loại bỏ deletedFor
      }

      // Thêm điều kiện tìm kiếm nếu có
      if (searchQuery) {
        query.$or = [{ name: { $regex: searchQuery, $options: 'i' } }]
      }

      // Tìm tất cả cuộc trò chuyện đã lưu trữ
      const conversations = await ChatModel.find(query)
        .populate({
          path: 'participants',
          select: 'name avatar'
        })
        .populate({
          path: 'lastMessage',
          populate: {
            path: 'senderId',
            select: 'name avatar'
          }
        })
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()

      // Đếm tổng số cuộc trò chuyện để phân trang
      const total = await ChatModel.countDocuments(query)

      // Tính toán thông tin phân trang
      const hasMore = skip + conversations.length < total
      const currentPage = page
      const totalPages = Math.ceil(total / limit)

      res.json(
        new AppSuccess({
          message: 'Get archived conversations successfully',
          data: {
            conversations,
            hasMore,
            currentPage,
            totalPages,
            total
          }
        })
      )
    } catch (error) {
      console.error('Error in getArchivedChats:', error)
      next(error)
    }
  }

  // Thêm phương thức để lưu trữ cuộc trò chuyện
  async archiveConversation(req: Request, res: Response, next: NextFunction) {
    try {
      const { conversationId } = req.params
      const userId = req.context?.user?._id

      console.log('Archiving conversation:', conversationId, 'by user:', userId)

      // Tìm và cập nhật cuộc trò chuyện
      const updatedConversation = await ChatModel.findOneAndUpdate(
        {
          _id: conversationId,
          participants: userId
        },
        { $set: { archived: true } }, // Đảm bảo sử dụng $set để cập nhật
        {
          new: true, // Trả về document sau khi cập nhật
          runValidators: true // Đảm bảo validate dữ liệu
        }
      )

      // Kiểm tra cuộc trò chuyện tồn tại
      if (!updatedConversation) {
        return next(
          new AppError({
            status: status.NOT_FOUND,
            message: 'Conversation not found'
          })
        )
      }

      // Log để kiểm tra
      console.log('Conversation after archive:', JSON.stringify(updatedConversation, null, 2))

      // Populate dữ liệu cần thiết
      await updatedConversation.populate([
        {
          path: 'participants',
          select: 'name avatar username'
        },
        {
          path: 'lastMessage',
          populate: {
            path: 'senderId',
            select: 'name avatar username'
          }
        }
      ])

      res.json(
        new AppSuccess({
          data: updatedConversation,
          message: 'Conversation archived successfully'
        })
      )
    } catch (error) {
      console.error('Error in archiveConversation:', error)
      next(error)
    }
  }

  // Thêm phương thức để bỏ lưu trữ cuộc trò chuyện
  async unarchiveConversation(req: Request, res: Response, next: NextFunction) {
    try {
      const { conversationId } = req.params
      const userId = req.context?.user?._id

      // Kiểm tra conversationId
      if (!conversationId) {
        return next(
          new AppError({
            status: status.BAD_REQUEST,
            message: 'Conversation ID is required'
          })
        )
      }

      // Kiểm tra tính hợp lệ của conversationId
      if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        return next(
          new AppError({
            status: status.BAD_REQUEST,
            message: 'Invalid conversation ID'
          })
        )
      }

      // Tìm cuộc trò chuyện
      const conversation = await ChatModel.findOne({
        _id: conversationId,
        participants: userId
      })

      // Kiểm tra cuộc trò chuyện tồn tại
      if (!conversation) {
        return next(
          new AppError({
            status: status.NOT_FOUND,
            message: 'Conversation not found'
          })
        )
      }

      // Cập nhật trạng thái archived
      conversation.archived = false
      await conversation.save()

      res.json(
        new AppSuccess({
          message: 'Conversation unarchived successfully',
          data: conversation
        })
      )
    } catch (error) {
      next(error)
    }
  }

  // Phương thức getUserConversations vẫn được giữ nguyên và đã được cập nhật
  // để lọc đúng các cuộc trò chuyện đã archive
  // Phương thức getConversations đã bị xóa vì nó trùng lặp với getUserConversations
  // và không được sử dụng trong routes

  // Thêm phương thức để ghim tin nhắn
  async pinMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const { messageId } = req.params
      const userId = req.context?.user?._id

      console.log('Pinning message:', messageId, 'by user:', userId)

      // Tìm tin nhắn
      const message = await MessageModel.findById(messageId)

      // Kiểm tra tin nhắn tồn tại
      if (!message) {
        return next(
          new AppError({
            status: status.NOT_FOUND,
            message: 'Message not found'
          })
        )
      }

      // Kiểm tra người dùng có trong cuộc trò chuyện không
      const chat = await ChatModel.findOne({
        _id: message.chatId,
        participants: userId
      })

      if (!chat) {
        return next(
          new AppError({
            status: status.FORBIDDEN,
            message: 'You do not have permission to pin this message'
          })
        )
      }

      // Cập nhật trạng thái ghim của tin nhắn
      message.isPinned = !message.isPinned
      await message.save()

      // Thông báo cho tất cả người dùng trong chat
      emitSocketEvent(message.chatId.toString(), SOCKET_EVENTS.MESSAGE_PINNED, {
        messageId: message._id,
        isPinned: message.isPinned,
        chatId: message.chatId.toString()
      })

      res.json(
        new AppSuccess({
          message: message.isPinned
            ? 'Message pinned successfully'
            : 'Message unpinned successfully',
          data: message
        })
      )
    } catch (error) {
      console.error('Error in pinMessage:', error)
      next(error)
    }
  }

  // Thêm phương thức để lấy tin nhắn đã ghim
  async getPinnedMessages(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.context?.user?._id as Types.ObjectId | string
      const chatId = req.params.chatId

      console.log('Getting pinned messages for chat:', chatId)

      // Kiểm tra chatId
      if (!chatId) {
        return next(
          new AppError({
            status: status.BAD_REQUEST,
            message: 'Chat ID is required'
          })
        )
      }

      // Kiểm tra tính hợp lệ của chatId
      if (!mongoose.Types.ObjectId.isValid(chatId)) {
        return next(
          new AppError({
            status: status.BAD_REQUEST,
            message: 'Invalid chat ID'
          })
        )
      }

      // Kiểm tra người dùng có trong cuộc trò chuyện không
      const chat = await ChatModel.findOne({
        _id: chatId,
        participants: userId
      })

      if (!chat) {
        return next(
          new AppError({
            status: status.FORBIDDEN,
            message: 'You are not a participant in this conversation'
          })
        )
      }

      // Lấy tin nhắn đã ghim và sắp xếp theo thời gian mới nhất
      const pinnedMessages = await MessageModel.find({
        chatId,
        isPinned: true
      })
        .populate('senderId', 'name avatar username')
        .sort({ createdAt: -1 }) // Sắp xếp theo thời gian mới nhất

      res.json(
        new AppSuccess({
          message: 'Get pinned messages successfully',
          data: pinnedMessages
        })
      )
    } catch (error) {
      console.error('Error in getPinnedMessages:', error)
      next(error)
    }
  }

  async createGroupConversation(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.context?.user?._id as Types.ObjectId | string
      const { participants, name, avatar, groupType, requireApproval } = req.body

      // Kiểm tra tên nhóm
      if (!name || name.trim() === '') {
        throw new AppError({ message: 'Tên nhóm không được để trống', status: 400 })
      }

      // Kiểm tra danh sách người tham gia
      if (!participants || !Array.isArray(participants) || participants.length < 2) {
        throw new AppError({ message: 'Nhóm chat phải có ít nhất 2 người tham gia', status: 400 })
      }

      // Kiểm tra giới hạn số lượng thành viên
      const totalMembers = participants.length + 1 // +1 cho người tạo nhóm
      const MAX_GROUP_MEMBERS = 100

      if (totalMembers > MAX_GROUP_MEMBERS) {
        throw new AppError({
          message: `Nhóm chat không thể có nhiều hơn ${MAX_GROUP_MEMBERS} thành viên`,
          status: 400
        })
      }

      // Đảm bảo nhóm riêng tư luôn yêu cầu phê duyệt
      const finalRequireApproval =
        groupType === GROUP_TYPE.PRIVATE ? true : requireApproval || false

      // Tạo nhóm chat mới
      const conversation = await ChatModel.create({
        userId, // Người tạo nhóm
        participants: [userId, ...participants],
        type: CHAT_TYPE.GROUP,
        groupType: groupType || GROUP_TYPE.PUBLIC,
        requireApproval: finalRequireApproval,
        name,
        avatar,
        members: [
          {
            userId,
            role: MEMBER_ROLE.OWNER,
            permissions: {
              changeGroupInfo: true,
              deleteMessages: true,
              banUsers: true,
              inviteUsers: true,
              pinMessages: true,
              addNewAdmins: true,
              approveJoinRequests: true
            },
            joinedAt: new Date()
          },
          ...participants.map((participantId) => ({
            userId: participantId,
            role: MEMBER_ROLE.MEMBER,
            permissions: {
              inviteUsers: true
            },
            joinedAt: new Date()
          }))
        ]
      })

      // Tạo tin nhắn hệ thống thông báo nhóm được tạo
      const systemMessage = await MessageModel.create({
        chatId: conversation._id,
        senderId: userId,
        content: `${req.context?.user?.name} đã tạo nhóm`,
        type: MESSAGE_TYPE.SYSTEM,
        status: MESSAGE_STATUS.DELIVERED
      })

      // Cập nhật lastMessage cho cuộc trò chuyện
      conversation.lastMessage = systemMessage._id as Schema.Types.ObjectId
      await conversation.save()

      // Thông báo cho tất cả thành viên về nhóm mới
      emitSocketEvent(String(conversation._id), SOCKET_EVENTS.GROUP_CREATED, {
        conversation: {
          ...conversation.toObject(),
          lastMessage: systemMessage
        },
        createdBy: userId
      })

      res.json(
        new AppSuccess({
          message: 'Tạo nhóm chat thành công',
          data: {
            ...conversation.toObject(),
            lastMessage: systemMessage
          }
        })
      )
    } catch (error) {
      next(error)
    }
  }

  async updateGroupMemberRole(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.context?.user?._id as Types.ObjectId | string
      // Lấy conversationId từ params
      const { conversationId } = req.params
      const { userId: targetUserId, role, permissions, customTitle } = req.body

      console.log('Update member role request:', {
        currentUserId: userId,
        conversationId,
        targetUserId,
        role,
        permissions
      })

      // Kiểm tra xem người dùng có quyền thay đổi vai trò không
      const conversation = await ChatModel.findById(conversationId)
      if (!conversation) {
        throw new AppError({ message: 'Không tìm thấy cuộc trò chuyện', status: 404 })
      }

      // Kiểm tra xem người dùng hiện tại có phải là thành viên của nhóm không
      const currentMember = conversation.members.find(
        (member) => member.userId.toString() === userId.toString()
      )

      if (!currentMember) {
        throw new AppError({ message: 'Bạn không phải là thành viên của nhóm này', status: 403 })
      }

      // Kiểm tra quyền (chỉ OWNER hoặc ADMIN có quyền thay đổi vai trò)
      const isAdmin =
        currentMember.role === MEMBER_ROLE.OWNER || currentMember.role === MEMBER_ROLE.ADMIN

      if (!isAdmin) {
        throw new AppError({
          message: 'Bạn không có quyền thay đổi vai trò thành viên',
          status: 403
        })
      }

      // Nếu không phải OWNER thì không thể thăng cấp người khác lên ADMIN
      if (currentMember.role !== MEMBER_ROLE.OWNER && role === MEMBER_ROLE.ADMIN) {
        throw new AppError({
          message: 'Chỉ chủ nhóm mới có thể thăng cấp thành viên lên quản trị viên',
          status: 403
        })
      }

      // Không thể thay đổi vai trò của OWNER
      const targetMember = conversation.members.find(
        (member) => member.userId.toString() === targetUserId
      )

      if (targetMember && targetMember.role === MEMBER_ROLE.OWNER) {
        throw new AppError({
          message: 'Không thể thay đổi vai trò của chủ nhóm',
          status: 403
        })
      }

      // Cập nhật vai trò và quyền của thành viên
      let memberIndex = conversation.members.findIndex(
        (member) => member.userId.toString() === targetUserId
      )

      if (memberIndex === -1) {
        // Nếu thành viên chưa có trong danh sách members, thêm mới
        conversation.members.push({
          userId: new Schema.Types.ObjectId(targetUserId),
          role,
          permissions,
          customTitle,
          joinedAt: new Date()
        })
      } else {
        // Cập nhật thông tin thành viên
        conversation.members[memberIndex].role = role
        conversation.members[memberIndex].permissions = permissions

        if (customTitle !== undefined) {
          conversation.members[memberIndex].customTitle = customTitle
        }
      }

      await conversation.save()

      // Tạo tin nhắn hệ thống thông báo thay đổi vai trò
      const currentUser = await UserModel.findById(userId).select('name')
      const targetUser = await UserModel.findById(targetUserId).select('name')

      const systemMessage = await MessageModel.create({
        chatId: conversation._id,
        senderId: userId,
        content: `${currentUser?.name || 'Người dùng'} đã thay đổi vai trò của ${targetUser?.name || 'thành viên'} thành ${role === MEMBER_ROLE.ADMIN ? 'Quản trị viên' : 'Thành viên'}`,
        type: MESSAGE_TYPE.SYSTEM,
        status: MESSAGE_STATUS.DELIVERED
      })

      // Cập nhật lastMessage
      conversation.lastMessage = systemMessage._id as Schema.Types.ObjectId
      await conversation.save()

      // Thông báo cho tất cả thành viên trong nhóm
      emitSocketEvent(conversationId.toString(), SOCKET_EVENTS.MEMBER_ROLE_UPDATED, {
        conversationId,
        userId: targetUserId,
        role,
        permissions,
        customTitle,
        updatedBy: userId,
        message: systemMessage
      })

      res.json(
        new AppSuccess({
          message: 'Cập nhật vai trò thành công',
          data: {
            conversation,
            message: systemMessage
          }
        })
      )
    } catch (error) {
      console.error('Error in updateGroupMemberRole:', error)
      next(error)
    }
  }

  async generateInviteLink(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.context?.user?._id as Types.ObjectId | string
      const { conversationId } = req.params

      // Kiểm tra quyền
      const conversation = await ChatModel.findById(conversationId)
      if (!conversation) {
        throw new AppError({ message: 'Không tìm thấy cuộc trò chuyện', status: 404 })
      }

      // Kiểm tra xem người dùng có phải là thành viên của nhóm không
      const isParticipant = conversation.participants.some(
        (p) => p.toString() === userId.toString()
      )

      if (!isParticipant) {
        throw new AppError({ message: 'Bạn không phải là thành viên của nhóm này', status: 403 })
      }

      // Kiểm tra quyền mời người dùng
      const member = conversation.members.find((m) => m.userId.toString() === userId.toString())
      const isOwnerOrAdmin =
        member?.role === MEMBER_ROLE.OWNER || member?.role === MEMBER_ROLE.ADMIN
      const canInvite = isOwnerOrAdmin || member?.permissions?.inviteUsers

      if (!canInvite) {
        throw new AppError({ message: 'Bạn không có quyền tạo link mời', status: 403 })
      }

      // Tạo link mời mới
      const newInviteLink = nanoid(10)
      conversation.inviteLink = newInviteLink
      await conversation.save()

      res.json(
        new AppSuccess({
          message: 'Tạo link mời thành công',
          data: {
            inviteLink: newInviteLink,
            fullLink: `${env.WEBSITE_URL}/group/join/${newInviteLink}`
          }
        })
      )
    } catch (error) {
      next(error)
    }
  }

  // Lấy thông tin nhóm từ link mời
  async getGroupByInviteLink(req: Request, res: Response, next: NextFunction) {
    try {
      const { inviteLink } = req.params
      const userId = req.context?.user?._id

      // Tìm nhóm bằng link mời
      const conversation = await ChatModel.findOne({ inviteLink })
        .populate('participants', '_id name avatar username')
        .populate('members.userId', '_id name avatar username')
        .lean()

      if (!conversation) {
        throw new AppError({ message: 'Link mời không hợp lệ hoặc đã hết hạn', status: 404 })
      }

      // Kiểm tra xem người dùng có trong danh sách participants không
      const isParticipant = conversation.participants.some(
        (p: any) => p._id.toString() === userId?.toString()
      )

      // Kiểm tra xem người dùng đã từng là thành viên và đã rời nhóm chưa
      const hasLeftGroup = conversation.formerMembers?.some(
        (member: any) => member.userId.toString() === userId?.toString()
      )

      // Lọc ra danh sách admin và owner
      const admins = conversation.members
        .filter(
          (member: any) => member.role === MEMBER_ROLE.OWNER || member.role === MEMBER_ROLE.ADMIN
        )
        .map((member: any) => ({
          _id: member.userId._id,
          name: member.userId.name,
          avatar: member.userId.avatar,
          username: member.userId.username,
          role: member.role
        }))

      // Trả về thông tin nhóm
      res.json(
        new AppSuccess({
          message: 'Lấy thông tin nhóm thành công',
          data: {
            _id: conversation._id,
            name: conversation.name,
            avatar: conversation.avatar,
            memberCount: conversation.participants.length,
            requireApproval: conversation.requireApproval,
            participants: conversation.participants,
            isParticipant,
            hasLeftGroup,
            admins, // Thêm danh sách admin và owner
            isPrivate: conversation.groupType === GROUP_TYPE.PRIVATE
          }
        })
      )
    } catch (error) {
      next(error)
    }
  }

  async joinGroupByInviteLink(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.context?.user?._id as Types.ObjectId | string
      const { inviteLink } = req.params

      // Tìm cuộc trò chuyện với link mời
      const conversation = await ChatModel.findOne({ inviteLink })
      if (!conversation) {
        throw new AppError({ message: 'Link mời không hợp lệ hoặc đã hết hạn', status: 404 })
      }

      // Kiểm tra xem người dùng đã là thành viên chưa
      const isAlreadyMember = conversation.members.some(
        (m) => m.userId.toString() === userId.toString()
      )

      if (isAlreadyMember) {
        res.json(
          new AppSuccess({
            data: { conversationId: conversation._id, alreadyMember: true },
            message: 'Bạn đã là thành viên của nhóm này'
          })
        )
        return
      }

      // Kiểm tra loại nhóm và yêu cầu phê duyệt
      const isPrivateGroup = conversation.groupType === GROUP_TYPE.PRIVATE
      const requiresApproval = isPrivateGroup || conversation.requireApproval

      if (requiresApproval) {
        // Kiểm tra xem đã có yêu cầu tham gia chưa
        const existingRequest = conversation.pendingRequests?.find(
          (req) => req.userId.toString() === userId.toString() && req.status === 'PENDING'
        )

        if (existingRequest) {
          res.json(
            new AppSuccess({
              data: { conversationId: conversation._id, pending: true },
              message: 'Yêu cầu tham gia của bạn đang chờ phê duyệt'
            })
          )
          return
        }

        // Thêm yêu cầu tham gia mới vào mảng pendingRequests
        const newRequest = {
          userId: new mongoose.Types.ObjectId(userId.toString()),
          requestedAt: new Date(),
          status: 'PENDING'
        }

        if (!conversation.pendingRequests) {
          conversation.pendingRequests = []
        }

        conversation.pendingRequests.push(newRequest as any)
        await conversation.save()

        // Thông báo cho admin và owner về yêu cầu tham gia mới
        const adminsAndOwners = conversation.members.filter(
          (m) => m.role === MEMBER_ROLE.ADMIN || m.role === MEMBER_ROLE.OWNER
        )

        // Tạo thông báo cho mỗi admin và owner
        for (const admin of adminsAndOwners) {
          try {
            // Kiểm tra xem đã có thông báo tương tự chưa
            const existingNotification = await NotificationModel.findOne({
              userId: admin.userId,
              type: NOTIFICATION_TYPE.JOIN_REQUEST,
              'metadata.conversationId': conversation._id,
              'metadata.invitedBy': userId
            });

            let notification;
            
            if (existingNotification) {
              // Nếu đã có thông báo, cập nhật lại thay vì tạo mới
              existingNotification.read = false;
              existingNotification.processed = false;
              existingNotification.content = `${req.context?.user?.name || 'Một thành viên'} đã gửi yêu cầu tham gia nhóm ${conversation.name}`;
              existingNotification.metadata = {
                conversationId: conversation._id,
                chatName: conversation.name,
                isGroup: true,
                requestingUser: userId
              };
              // Cập nhật thời gian tạo để đưa thông báo lên đầu
              existingNotification.set('createdAt', new Date());
              
              await existingNotification.save();
              notification = existingNotification;
            } else {
              // Tạo thông báo mới nếu chưa có
              notification = await NotificationModel.create({
                userId: admin.userId,
                type: NOTIFICATION_TYPE.JOIN_REQUEST,
                content: `${req.context?.user?.name || 'Một thành viên'} đã gửi yêu cầu tham gia nhóm ${conversation.name}`,
                metadata: {
                  conversationId: conversation._id,
                  chatName: conversation.name,
                  isGroup: true,
                  requestingUser: userId
                },
                read: false,
                processed: false,
                senderId: userId,
                relatedId: conversation._id
              });
            }

            // Lấy thông tin người gửi để gửi kèm thông báo
            const sender = await UserModel.findById(userId).select('name avatar');

            // Chuẩn bị thông báo để gửi qua socket
            const notificationToSend = {
              ...notification.toObject(),
              senderId: {
                _id: sender?._id,
                name: sender?.name,
                avatar: sender?.avatar
              }
            };

            emitSocketEvent(
              admin.userId.toString(),
              SOCKET_EVENTS.NOTIFICATION_NEW,
              notificationToSend
            );

            // Gửi thêm sự kiện NEW_JOIN_REQUEST để đảm bảo tương thích
            emitSocketEvent(admin.userId.toString(), SOCKET_EVENTS.NEW_JOIN_REQUEST, {
              conversationId: conversation._id,
              invitedBy: userId,
              userIds: [userId],
              notification: notificationToSend // Gửi kèm thông báo đầy đủ
            });
          } catch (error) {
            console.error('Error creating notification:', error);
          }
        }

        // Thông báo cho admin và owner về yêu cầu tham gia mới
        for (const admin of adminsAndOwners) {
          emitSocketEvent(admin.userId.toString(), SOCKET_EVENTS.JOIN_REQUEST_RECEIVED, {
            conversationId: conversation._id,
            userId
          });
        }

        res.json(
          new AppSuccess({
            data: { conversationId: conversation._id, pending: true },
            message: 'Yêu cầu tham gia của bạn đã được gửi và đang chờ phê duyệt'
          })
        )
        return
      } else {
        // Nhóm công khai không yêu cầu phê duyệt - thêm người dùng vào nhóm ngay lập tức
        conversation.members.push({
          userId: new Schema.Types.ObjectId(userId.toString()),
          role: MEMBER_ROLE.MEMBER,
          permissions: {
            inviteUsers: true
          },
          joinedAt: new Date()
        })

        // Thêm người dùng vào danh sách participants
        if (!conversation.participants.some((p) => p.toString() === userId.toString())) {
          conversation.participants.push(new Schema.Types.ObjectId(userId.toString()))
        }

        await conversation.save()

        // Tạo tin nhắn hệ thống thông báo thành viên mới
        const user = await UserModel.findById(userId).select('name')
        const systemMessage = await MessageModel.create({
          chatId: conversation._id,
          senderId: userId,
          content: `${user?.name || 'Người dùng'} đã tham gia nhóm`,
          type: MESSAGE_TYPE.SYSTEM,
          status: MESSAGE_STATUS.DELIVERED
        })

        // Cập nhật lastMessage
        conversation.lastMessage = systemMessage._id as Schema.Types.ObjectId
        await conversation.save()

        // Thông báo cho các thành viên khác
        emitSocketEvent(String(conversation?._id), SOCKET_EVENTS.MEMBER_JOINED, {
          conversationId: conversation._id,
          userId,
          message: systemMessage
        })

        res.json(
          new AppSuccess({
            data: { conversationId: conversation._id, joined: true },
            message: 'Bạn đã tham gia nhóm thành công'
          })
        )
        return
      }
    } catch (error) {
      next(error)
    }
  }

  async getJoinRequests(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.context?.user?._id
      const { conversationId } = req.params

      console.log('Getting join requests for conversation:', conversationId)

      // Kiểm tra quyền
      const conversation = await ChatModel.findById(conversationId)
        .populate('pendingRequests.userId', 'name avatar username')
        .populate('pendingRequests.invitedBy', 'name avatar username')

      if (!conversation) {
        throw new AppError({ message: 'Không tìm thấy cuộc trò chuyện', status: 404 })
      }

      // Kiểm tra xem người dùng có quyền xem yêu cầu tham gia không
      const member = conversation.members.find((m) => m.userId.toString() === String(userId))
      const isOwnerOrAdmin =
        member?.role === MEMBER_ROLE.OWNER || member?.role === MEMBER_ROLE.ADMIN
      const canApprove = isOwnerOrAdmin || member?.permissions?.approveJoinRequests

      if (!canApprove) {
        throw new AppError({ message: 'Bạn không có quyền xem yêu cầu tham gia', status: 403 })
      }

      // Trả về danh sách yêu cầu tham gia đã được populate đầy đủ thông tin
      res.json(
        new AppSuccess({
          message: 'Lấy danh sách yêu cầu tham gia thành công',
          data: conversation.pendingRequests
        })
      )
    } catch (error) {
      console.error('Error in getJoinRequests:', error)
      next(error)
    }
  }

  async approveJoinRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const currentUserId = req.context?.user?._id
      const { conversationId, userId: targetUserId } = req.params

      // Kiểm tra quyền
      const conversation = await ChatModel.findById(conversationId)

      if (!conversation) {
        throw new AppError({ message: 'Không tìm thấy cuộc trò chuyện', status: 404 })
      }

      // Kiểm tra xem người dùng có quyền phê duyệt yêu cầu tham gia không
      const member = conversation.members.find((m) => m.userId.toString() === String(currentUserId))
      const isOwnerOrAdmin =
        member?.role === MEMBER_ROLE.OWNER || member?.role === MEMBER_ROLE.ADMIN
      const canApprove = isOwnerOrAdmin || member?.permissions?.approveJoinRequests

      if (!canApprove) {
        throw new AppError({
          message: 'Bạn không có quyền phê duyệt yêu cầu tham gia',
          status: 403
        })
      }

      // Tìm yêu cầu tham gia
      const requestIndex = conversation.pendingRequests
        ? conversation.pendingRequests.findIndex(
            (req) => req.userId.toString() === targetUserId && req.status === 'PENDING'
          )
        : -1

      if (requestIndex === -1 || requestIndex === undefined) {
        throw new AppError({ message: 'Không tìm thấy yêu cầu tham gia', status: 404 })
      }

      // Cập nhật trạng thái yêu cầu
      if (conversation.pendingRequests) {
        conversation.pendingRequests[requestIndex].status = 'APPROVED'
      }

      // Kiểm tra xem người dùng đã có trong members chưa
      const isAlreadyMember = conversation.members.some(m => m.userId.toString() === targetUserId)
      
      if (!isAlreadyMember) {
        // Thêm người dùng vào nhóm chỉ khi chưa là thành viên
        // Thêm vào participants
        if (!conversation.participants.some(p => p.toString() === targetUserId)) {
          conversation.participants.push(targetUserId)
        }
        
        // Thêm vào members
        conversation.members.push({
          userId: targetUserId,
          role: MEMBER_ROLE.MEMBER,
          permissions: {
            inviteUsers: true
          },
          joinedAt: new Date()
        })
        
        // Lưu các thay đổi
        await conversation.save()
        
        // Lấy thông tin người dùng
        const user = await UserModel.findById(targetUserId).select('name avatar')
        
        // Tạo tin nhắn hệ thống - CHỈ TẠO KHI THỰC SỰ THÊM THÀNH VIÊN MỚI
        const systemMessage = await MessageModel.create({
          chatId: conversation._id,
          senderId: currentUserId,
          content: `${user?.name} đã được chấp nhận tham gia nhóm`,
          type: MESSAGE_TYPE.SYSTEM,
          status: MESSAGE_STATUS.DELIVERED
        })
        
        // Cập nhật lastMessage
        conversation.lastMessage = systemMessage._id
        await conversation.save()
        
        // Thông báo cho người dùng đã được chấp nhận
        emitSocketEvent(targetUserId.toString(), SOCKET_EVENTS.JOIN_REQUEST_APPROVED, {
          conversationId: conversation._id,
          message: systemMessage
        })
      } else {
        // Nếu đã là thành viên, chỉ cập nhật trạng thái yêu cầu
        await conversation.save()
      }

      res.json(
        new AppSuccess({
          message: 'Yêu cầu tham gia đã được chấp nhận',
          data: { conversationId: conversation._id, userId: targetUserId }
        })
      )
    } catch (error) {
      console.error('Error in approveJoinRequest:', error)
      next(error)
    }
  }

  async rejectJoinRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const currentUserId = req.context?.user?._id
      const { conversationId, userId: targetUserId } = req.params

      // Kiểm tra quyền
      const conversation = await ChatModel.findById(conversationId)

      if (!conversation) {
        throw new AppError({ message: 'Không tìm thấy cuộc trò chuyện', status: 404 })
      }

      // Kiểm tra xem người dùng có quyền từ chối yêu cầu tham gia không
      const member = conversation.members.find((m) => m.userId.toString() === String(currentUserId))
      const isOwnerOrAdmin =
        member?.role === MEMBER_ROLE.OWNER || member?.role === MEMBER_ROLE.ADMIN
      const canApprove = isOwnerOrAdmin || member?.permissions?.approveJoinRequests

      if (!canApprove) {
        throw new AppError({
          message: 'Bạn không có quyền từ chối yêu cầu tham gia',
          status: 403
        })
      }

      // Tìm yêu cầu tham gia
      const requestIndex = conversation.pendingRequests
        ? conversation.pendingRequests.findIndex(
            (req) => req.userId.toString() === targetUserId && req.status === 'PENDING'
          )
        : -1

      if (requestIndex === -1 || requestIndex === undefined) {
        throw new AppError({ message: 'Không tìm thấy yêu cầu tham gia', status: 404 })
      }

      // Cập nhật trạng thái yêu cầu
      if (conversation.pendingRequests) {
        conversation.pendingRequests[requestIndex].status = 'REJECTED'
      }

      await conversation.save()

      // Thông báo cho người dùng đã bị từ chối
      emitSocketEvent(targetUserId.toString(), SOCKET_EVENTS.JOIN_REQUEST_REJECTED, {
        conversationId: conversation._id,
        message: 'Yêu cầu tham gia nhóm đã bị từ chối'
      })

      res.json(
        new AppSuccess({
          message: 'Yêu cầu tham gia đã bị từ chối',
          data: { conversationId: conversation._id, userId: targetUserId }
        })
      )
    } catch (error) {
      next(error)
    }
  }

  // Thêm phương thức xóa thành viên khỏi nhóm
  async removeGroupMember(req: Request, res: Response, next: NextFunction) {
    try {
      const { conversationId, userId: memberIdToRemove } = req.params
      const currentUserId = req.context?.user?._id

      console.log('Removing member from group:', {
        conversationId,
        memberIdToRemove,
        currentUserId
      })

      // Kiểm tra conversationId
      if (!conversationId || !memberIdToRemove) {
        return next(
          new AppError({
            status: status.BAD_REQUEST,
            message: 'Conversation ID and Member ID are required'
          })
        )
      }

      // Tìm cuộc trò chuyện
      const conversation = await ChatModel.findById(conversationId)

      // Kiểm tra cuộc trò chuyện tồn tại
      if (!conversation) {
        return next(
          new AppError({
            status: status.NOT_FOUND,
            message: 'Conversation not found'
          })
        )
      }

      // Kiểm tra người dùng hiện tại có quyền xóa thành viên không (phải là admin)
      if (conversation.userId.toString() !== currentUserId?.toString()) {
        return next(
          new AppError({
            status: status.FORBIDDEN,
            message: 'You do not have permission to remove members from this group'
          })
        )
      }

      // Kiểm tra thành viên cần xóa có trong nhóm không
      const isMember = conversation.participants.some(
        (participant) => participant.toString() === memberIdToRemove
      )

      if (!isMember) {
        return next(
          new AppError({
            status: status.BAD_REQUEST,
            message: 'User is not a member of this group'
          })
        )
      }

      // Không cho phép xóa admin (người tạo nhóm)
      if (memberIdToRemove === conversation.userId.toString()) {
        return next(
          new AppError({
            status: status.BAD_REQUEST,
            message: 'Cannot remove the group admin'
          })
        )
      }

      // Xóa thành viên khỏi danh sách participants
      conversation.participants = conversation.participants.filter(
        (participant) => participant.toString() !== memberIdToRemove
      )

      // Xóa thành viên khỏi danh sách members
      conversation.members = conversation.members.filter(
        (member) => member.userId.toString() !== memberIdToRemove
      )

      await conversation.save()

      // Tạo tin nhắn hệ thống thông báo thành viên bị xóa
      const removedUser = await UserModel.findById(memberIdToRemove).select('name')
      const systemMessage = await MessageModel.create({
        chatId: conversation._id,
        senderId: currentUserId,
        content: `${removedUser?.name || 'Thành viên'} đã bị xóa khỏi nhóm`,
        type: MESSAGE_TYPE.SYSTEM,
        status: MESSAGE_STATUS.DELIVERED
      })

      // Cập nhật lastMessage cho cuộc trò chuyện
      conversation.lastMessage = systemMessage._id as unknown as Schema.Types.ObjectId
      await conversation.save()

      // Thông báo cho tất cả thành viên trong nhóm
      emitSocketEvent(conversationId, SOCKET_EVENTS.MEMBER_REMOVED, {
        conversationId,
        removedUserId: memberIdToRemove,
        removedBy: currentUserId,
        message: systemMessage.toObject() // Đảm bảo gửi đầy đủ thông tin tin nhắn
      })

      res.json(
        new AppSuccess({
          data: { conversationId, removedUserId: memberIdToRemove },
          message: 'Member removed from group successfully'
        })
      )
    } catch (error) {
      console.error('Error removing member from group:', error)
      next(error)
    }
  }

  // Thêm thành viên vào nhóm
  async addGroupMembers(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.context?.user?._id as Types.ObjectId | string
      const { conversationId } = req.params
      const { userIds } = req.body

      if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
        next(
          new AppError({
            status: status.BAD_REQUEST,
            message: 'User IDs are required and must be an array'
          })
        )
        return
      }

      // Tìm cuộc trò chuyện
      const conversation = await ChatModel.findById(conversationId)

      if (!conversation) {
        next(
          new AppError({
            status: status.NOT_FOUND,
            message: 'Conversation not found'
          })
        )
        return
      }

      // Kiểm tra người dùng hiện tại có quyền thêm thành viên không
      const currentMember = conversation.members.find(
        (member) => member.userId.toString() === userId.toString()
      )

      if (!currentMember) {
        next(
          new AppError({
            status: status.FORBIDDEN,
            message: 'You are not a member of this group'
          })
        )
        return
      }

      const isAdmin =
        currentMember.role === MEMBER_ROLE.OWNER || currentMember.role === MEMBER_ROLE.ADMIN
      const canInvite = isAdmin || currentMember.permissions?.inviteUsers

      if (!canInvite) {
        next(
          new AppError({
            status: status.FORBIDDEN,
            message: 'You do not have permission to add members to this group'
          })
        )
        return
      }

      // Kiểm tra giới hạn số lượng thành viên
      const MAX_GROUP_MEMBERS = 100
      if (conversation.participants.length + userIds.length > MAX_GROUP_MEMBERS) {
        next(
          new AppError({
            status: status.BAD_REQUEST,
            message: `Group cannot have more than ${MAX_GROUP_MEMBERS} members`
          })
        )
        return
      }

      // Lọc ra những người dùng chưa có trong nhóm
      const newUserIds = userIds.filter(
        (id) => !conversation.participants.some((p) => p.toString() === id)
      )

      if (newUserIds.length === 0) {
        res.json(
          new AppSuccess({
            message: 'All users are already members of this group',
            data: { conversationId }
          })
        )
        return
      }

      // Kiểm tra loại nhóm và yêu cầu phê duyệt
      const isPrivateGroup = conversation.groupType === GROUP_TYPE.PRIVATE
      const requiresApproval = isPrivateGroup || conversation.requireApproval

      // Nếu là nhóm private hoặc yêu cầu phê duyệt, thêm vào danh sách chờ
      if (requiresApproval && !isAdmin) {
        // Chỉ admin và owner có thể thêm thành viên trực tiếp vào nhóm private
        // Người dùng thường chỉ có thể gửi lời mời, cần được phê duyệt

        // Lọc ra những người dùng chưa có trong danh sách chờ
        const existingPendingRequests = conversation.pendingRequests || []
        const existingPendingUserIds = existingPendingRequests
          .filter((req) => req.status === 'PENDING')
          .map((req) => req.userId.toString())

        // Chỉ thêm những người dùng chưa có trong danh sách chờ
        const newPendingUserIds = newUserIds.filter((id) => !existingPendingUserIds.includes(id))

        if (newPendingUserIds.length === 0) {
          res.json(
            new AppSuccess({
              message: 'Tất cả người dùng đã được mời trước đó',
              data: { conversationId, pendingApproval: true }
            })
          )
          return
        }

        // Chuẩn bị các yêu cầu tham gia mới
        const pendingRequests = newPendingUserIds.map((id) => ({
          userId: new mongoose.Types.ObjectId(id),
          requestedAt: new Date(),
          status: 'PENDING',
          invitedBy: userId // Thêm thông tin người mời
        }))

        // Thêm vào danh sách chờ
        await ChatModel.findByIdAndUpdate(conversationId, {
          $push: {
            pendingRequests: { $each: pendingRequests }
          }
        })

        // Tìm các admin và owner để gửi thông báo
        const adminsAndOwners = conversation.members.filter(
          (member) => member.role === MEMBER_ROLE.OWNER || member.role === MEMBER_ROLE.ADMIN
        )

        // Lấy thông tin người mời
        const inviter = await UserModel.findById(userId).select('name')

        // Tạo thông báo cho mỗi admin và owner
        for (const admin of adminsAndOwners) {
          try {
            // Kiểm tra xem đã có thông báo tương tự chưa
            const existingNotification = await NotificationModel.findOne({
              userId: admin.userId,
              type: NOTIFICATION_TYPE.JOIN_REQUEST,
              'metadata.conversationId': conversation._id,
              'metadata.invitedBy': userId
            });

            let notification;
            
            if (existingNotification) {
              // Nếu đã có thông báo, cập nhật lại thay vì tạo mới
              existingNotification.read = false;
              existingNotification.processed = false;
              existingNotification.content = `${inviter?.name || 'Một thành viên'} đã mời ${newPendingUserIds.length} người vào nhóm ${conversation.name || 'của bạn'}`;
              existingNotification.metadata = {
                conversationId: conversation._id,
                chatName: conversation.name || 'Nhóm chat',
                invitedBy: userId,
                userIds: newPendingUserIds,
                timestamp: new Date() // Thêm timestamp mới
              };
              // Cập nhật thời gian tạo để đưa thông báo lên đầu
              existingNotification.set('createdAt', new Date());
              
              await existingNotification.save();
              notification = existingNotification;
            } else {
              // Tạo thông báo mới nếu chưa có
              notification = await NotificationModel.create({
                userId: admin.userId,
                type: NOTIFICATION_TYPE.JOIN_REQUEST,
                content: `${inviter?.name || 'Một thành viên'} đã mời ${newPendingUserIds.length} người vào nhóm ${conversation.name || 'của bạn'}`,
                metadata: {
                  conversationId: conversation._id,
                  chatName: conversation.name || 'Nhóm chat',
                  invitedBy: userId,
                  userIds: newPendingUserIds
                },
                read: false,
                processed: false,
                senderId: userId,
                relatedId: conversation._id
              });
            }

            // Lấy thông tin người gửi để gửi kèm thông báo
            const sender = await UserModel.findById(userId).select('name avatar');

            // Chuẩn bị thông báo để gửi qua socket
            const notificationToSend = {
              ...notification.toObject(),
              senderId: {
                _id: sender?._id,
                name: sender?.name,
                avatar: sender?.avatar
              }
            };

            emitSocketEvent(
              admin.userId.toString(),
              SOCKET_EVENTS.NOTIFICATION_NEW,
              notificationToSend
            );

            // Gửi thêm sự kiện NEW_JOIN_REQUEST để đảm bảo tương thích
            emitSocketEvent(admin.userId.toString(), SOCKET_EVENTS.NEW_JOIN_REQUEST, {
              conversationId: conversation._id,
              invitedBy: userId,
              userIds: newPendingUserIds,
              notification: notificationToSend // Gửi kèm thông báo đầy đủ
            });
          } catch (error) {
            console.error('Error creating notification:', error);
          }
        }

        res.json(
          new AppSuccess({
            message: 'Lời mời đã được gửi và đang chờ phê duyệt',
            data: { conversationId, pendingApproval: true }
          })
        )
        return
      }

      // Nếu là nhóm public hoặc người dùng là admin/owner, thêm thành viên trực tiếp
      // Chuẩn bị các thành viên mới để thêm vào
      const newParticipants = newUserIds.map((id) => new mongoose.Types.ObjectId(id))
      const newMembers = newUserIds.map((id) => ({
        userId: new mongoose.Types.ObjectId(id),
        role: MEMBER_ROLE.MEMBER,
        permissions: {
          inviteUsers: true
        },
        joinedAt: new Date()
      }))

      // Sử dụng findByIdAndUpdate để cập nhật conversation
      await ChatModel.findByIdAndUpdate(conversationId, {
        $push: {
          participants: { $each: newParticipants },
          members: { $each: newMembers }
        }
      })

      // Lấy thông tin người dùng hiện tại
      const currentUser = await UserModel.findById(userId).select('name')

      // Tạo tin nhắn hệ thống
      const systemMessage = await MessageModel.create({
        chatId: conversation._id,
        senderId: userId,
        content: `${currentUser?.name || 'Một thành viên'} đã thêm ${newUserIds.length} thành viên mới vào nhóm`,
        type: MESSAGE_TYPE.SYSTEM,
        status: MESSAGE_STATUS.DELIVERED
      })

      // Cập nhật lastMessage cho cuộc trò chuyện
      await ChatModel.findByIdAndUpdate(conversationId, {
        lastMessage: systemMessage._id
      })

      // Thông báo cho tất cả thành viên trong nhóm
      emitSocketEvent(conversationId.toString(), SOCKET_EVENTS.MEMBERS_ADDED, {
        conversationId,
        addedBy: userId,
        newMembers: newUserIds,
        message: systemMessage.toObject ? systemMessage.toObject() : systemMessage // Đảm bảo gửi đầy đủ thông tin tin nhắn
      })

      res.json(
        new AppSuccess({
          message: 'Thêm thành viên thành công',
          data: {
            conversationId,
            addedMembers: newUserIds
          }
        })
      )
    } catch (error) {
      next(error)
    }
  }

  // Thêm phương thức rời khỏi nhóm
  async leaveGroupConversation(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.context?.user?._id as Types.ObjectId | string
      const { conversationId } = req.params

      // Tìm cuộc trò chuyện
      const conversation = await ChatModel.findById(conversationId)
      if (!conversation) {
        throw new AppError({ message: 'Không tìm thấy cuộc trò chuyện', status: 404 })
      }

      // Kiểm tra xem người dùng có phải là thành viên của nhóm không
      const isParticipant = conversation.participants.some(
        (p) => p.toString() === userId.toString()
      )

      if (!isParticipant) {
        throw new AppError({ message: 'Bạn không phải là thành viên của nhóm này', status: 403 })
      }

      // Kiểm tra xem người dùng có phải là chủ nhóm không
      const isOwner = conversation.members.some(
        (m) => m.userId.toString() === userId.toString() && m.role === MEMBER_ROLE.OWNER
      )

      if (isOwner) {
        throw new AppError({
          message:
            'Chủ nhóm không thể rời nhóm. Vui lòng chuyển quyền chủ nhóm trước khi rời nhóm.',
          status: 403
        })
      }

      // Sử dụng findByIdAndUpdate để cập nhật conversation
      await ChatModel.findByIdAndUpdate(conversationId, {
        $pull: {
          participants: userId,
          members: { userId: userId }
        },
        $push: {
          formerMembers: {
            userId: userId,
            leftAt: new Date()
          }
        }
      })

      // Tạo tin nhắn hệ thống
      const user = await UserModel.findById(userId).select('name')
      const systemMessage = await MessageModel.create({
        chatId: conversation._id,
        senderId: userId,
        content: `${user?.name || 'Người dùng'} đã rời khỏi nhóm`,
        type: MESSAGE_TYPE.SYSTEM,
        status: MESSAGE_STATUS.DELIVERED
      })

      // Cập nhật lastMessage
      await ChatModel.findByIdAndUpdate(conversationId, { lastMessage: systemMessage._id })

      // Thông báo cho tất cả thành viên trong nhóm
      emitSocketEvent(conversationId.toString(), SOCKET_EVENTS.MEMBER_LEFT, {
        conversationId,
        userId,
        message: systemMessage
      })

      res.json(
        new AppSuccess({
          message: 'Đã rời khỏi nhóm thành công',
          data: { conversationId }
        })
      )
    } catch (error) {
      next(error)
    }
  }

  // Thêm phương thức xóa nhóm (chỉ admin)
  async deleteGroupConversation(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.context?.user?._id as Types.ObjectId | string
      const { conversationId } = req.params

      // Tìm cuộc trò chuyện
      const conversation = await ChatModel.findById(conversationId)
      if (!conversation) {
        throw new AppError({ message: 'Không tìm thấy cuộc trò chuyện', status: 404 })
      }

      // Kiểm tra xem người dùng có phải là chủ nhóm không
      if (conversation.userId.toString() !== userId.toString()) {
        throw new AppError({ message: 'Chỉ chủ nhóm mới có thể xóa nhóm', status: 403 })
      }

      // Xóa cuộc trò chuyện
      await ChatModel.findByIdAndDelete(conversationId)

      // Xóa tất cả tin nhắn trong cuộc trò chuyện
      await MessageModel.deleteMany({ chatId: conversationId })

      // Thông báo cho tất cả người dùng trong cuộc trò chuyện
      emitSocketEvent(conversationId.toString(), SOCKET_EVENTS.CONVERSATION_DELETED, {
        conversationId,
        deletedBy: userId
      })

      res.json(
        new AppSuccess({
          data: { conversationId },
          message: 'Nhóm đã được xóa thành công'
        })
      )
    } catch (error) {
      next(error)
    }
  }

  // Cập nhật controller để kiểm tra quyền truy cập vào chat
  async checkChatAccess(req: Request, res: Response, next: NextFunction) {
    try {
      const { conversationId } = req.params
      const userId = req.context?.user?._id as string

      // Tìm cuộc trò chuyện
      const conversation = await ChatModel.findById(conversationId)

      if (!conversation) {
        throw new AppError({
          status: status.NOT_FOUND,
          message: 'Cuộc trò chuyện không tồn tại hoặc đã bị xóa'
        })
      }

      // Kiểm tra xem người dùng có trong danh sách participants không
      const isParticipant = conversation.participants.some(
        (p) => p.toString() === userId.toString()
      )

      if (!isParticipant) {
        throw new AppError({
          status: status.FORBIDDEN,
          message: 'Bạn không phải là thành viên của cuộc trò chuyện này'
        })
      }

      // Nếu mọi thứ OK, trả về thông tin cuộc trò chuyện cơ bản
      res.json(
        new AppSuccess({
          message: 'Bạn có quyền truy cập vào cuộc trò chuyện này',
          data: {
            conversationId: conversation._id,
            type: conversation.type,
            name: conversation.name
          }
        })
      )
    } catch (error) {
      next(error)
    }
  }

  // Thêm phương thức chuyển quyền owner
  async transferOwnership(req: Request, res: Response, next: NextFunction) {
    try {
      const currentUserId = req.context?.user?._id as Types.ObjectId | string
      const { conversationId } = req.params
      const { newOwnerId } = req.body

      if (!newOwnerId) {
        return next(
          new AppError({
            status: status.BAD_REQUEST,
            message: 'Vui lòng chọn thành viên để chuyển quyền chủ nhóm'
          })
        )
      }

      // Tìm cuộc trò chuyện
      const conversation = await ChatModel.findById(conversationId)
      if (!conversation) {
        return next(
          new AppError({
            status: status.NOT_FOUND,
            message: 'Không tìm thấy cuộc trò chuyện'
          })
        )
      }

      // Kiểm tra xem người dùng hiện tại có phải là owner không
      const isOwner = conversation.members.some(
        (m) => m.userId.toString() === currentUserId.toString() && m.role === MEMBER_ROLE.OWNER
      )

      if (!isOwner) {
        return next(
          new AppError({
            status: status.FORBIDDEN,
            message: 'Chỉ chủ nhóm mới có thể chuyển quyền chủ nhóm'
          })
        )
      }

      // Kiểm tra xem người được chuyển quyền có phải là thành viên của nhóm không
      const isNewOwnerMember = conversation.members.some(
        (m) => m.userId.toString() === newOwnerId.toString()
      )

      if (!isNewOwnerMember) {
        return next(
          new AppError({
            status: status.BAD_REQUEST,
            message: 'Người được chọn không phải là thành viên của nhóm'
          })
        )
      }

      // Cập nhật quyền cho owner mới
      await ChatModel.updateOne(
        { _id: conversationId, 'members.userId': newOwnerId },
        {
          $set: {
            'members.$.role': MEMBER_ROLE.OWNER,
            'members.$.permissions': {
              changeGroupInfo: true,
              deleteMessages: true,
              banUsers: true,
              inviteUsers: true,
              pinMessages: true,
              addNewAdmins: true,
              approveJoinRequests: true
            }
          }
        }
      )

      // Cập nhật quyền cho owner cũ thành ADMIN
      await ChatModel.updateOne(
        { _id: conversationId, 'members.userId': currentUserId },
        {
          $set: {
            'members.$.role': MEMBER_ROLE.ADMIN,
            'members.$.permissions': {
              changeGroupInfo: true,
              deleteMessages: true,
              banUsers: true,
              inviteUsers: true,
              pinMessages: true,
              addNewAdmins: false,
              approveJoinRequests: true
            }
          }
        }
      )

      // Cập nhật userId của nhóm
      await ChatModel.findByIdAndUpdate(conversationId, { userId: newOwnerId })

      // Lấy thông tin người dùng
      const currentUser = await UserModel.findById(currentUserId).select('name')
      const newOwner = await UserModel.findById(newOwnerId).select('name')

      // Tạo tin nhắn hệ thống
      const systemMessage = await MessageModel.create({
        chatId: conversation._id,
        senderId: currentUserId,
        content: `${currentUser?.name || 'Chủ nhóm'} đã chuyển quyền chủ nhóm cho ${newOwner?.name || 'thành viên mới'}`,
        type: MESSAGE_TYPE.SYSTEM,
        status: MESSAGE_STATUS.DELIVERED
      })

      // Cập nhật lastMessage
      await ChatModel.findByIdAndUpdate(conversationId, { lastMessage: systemMessage._id })

      // Thông báo cho tất cả thành viên trong nhóm
      emitSocketEvent(conversationId.toString(), SOCKET_EVENTS.OWNERSHIP_TRANSFERRED, {
        conversationId,
        previousOwnerId: currentUserId,
        newOwnerId,
        message: systemMessage
      })

      res.json(
        new AppSuccess({
          message: 'Đã chuyển quyền chủ nhóm thành công',
          data: {
            conversationId,
            newOwnerId,
            message: systemMessage
          }
        })
      )
    } catch (error) {
      next(error)
    }
  }

  // Thêm phương thức giải tán nhóm (chỉ owner)
  async disbandGroup(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.context?.user?._id as Types.ObjectId | string
      const { conversationId } = req.params

      // Tìm cuộc trò chuyện
      const conversation = await ChatModel.findById(conversationId)
      if (!conversation) {
        throw new AppError({ message: 'Không tìm thấy cuộc trò chuyện', status: 404 })
      }

      // Kiểm tra xem người dùng có phải là chủ nhóm không
      if (conversation.userId.toString() !== userId.toString()) {
        throw new AppError({ message: 'Chỉ chủ nhóm mới có thể giải tán nhóm', status: 403 })
      }

      // Xóa cuộc trò chuyện
      await ChatModel.findByIdAndDelete(conversationId)

      // Xóa tất cả tin nhắn trong cuộc trò chuyện
      await MessageModel.deleteMany({ chatId: conversationId })

      // Thông báo cho tất cả người dùng trong cuộc trò chuyện
      emitSocketEvent(conversationId.toString(), SOCKET_EVENTS.GROUP_DISBANDED, {
        conversationId,
        conversationName: conversation.name,
        disbandedBy: userId
      })

      res.json(
        new AppSuccess({
          data: { conversationId },
          message: 'Nhóm đã được giải tán thành công'
        })
      )
    } catch (error) {
      next(error)
    }
  }

  // Cập nhật thông tin nhóm
  async updateGroupConversation(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.context?.user?._id
      const { conversationId } = req.params
      const { name, avatar, groupType, requireApproval } = req.body

      console.log('Updating group conversation:', {
        userId,
        conversationId,
        updates: { name, avatar, groupType, requireApproval }
      })

      // Tìm cuộc trò chuyện
      const conversation = await ChatModel.findById(conversationId)
      if (!conversation) {
        throw new AppError({ message: 'Không tìm thấy cuộc trò chuyện', status: 404 })
      }

      // Kiểm tra quyền
      const member = conversation.members.find((m) => m.userId.toString() === String(userId))
      const canChangeInfo =
        member?.role === MEMBER_ROLE.OWNER ||
        member?.role === MEMBER_ROLE.ADMIN ||
        member?.permissions?.changeGroupInfo

      if (!canChangeInfo) {
        throw new AppError({
          message: 'Bạn không có quyền thay đổi thông tin nhóm',
          status: 403
        })
      }

      // Cập nhật thông tin
      if (name) conversation.name = name
      if (avatar) conversation.avatar = avatar

      // Cập nhật loại nhóm nếu có
      if (groupType) conversation.groupType = groupType

      // Đảm bảo nhóm riêng tư luôn yêu cầu phê duyệt
      if (groupType === GROUP_TYPE.PRIVATE) {
        conversation.requireApproval = true
      } else if (requireApproval !== undefined) {
        conversation.requireApproval = requireApproval
      }

      await conversation.save()

      // Thông báo cho tất cả thành viên về thay đổi
      emitSocketEvent(String(conversation._id), SOCKET_EVENTS.GROUP_UPDATED, {
        conversationId: conversation._id,
        updatedBy: userId,
        updates: {
          name: name || undefined,
          avatar: avatar || undefined,
          groupType: groupType || undefined,
          requireApproval: conversation.requireApproval
        }
      })

      res.json(
        new AppSuccess({
          data: conversation,
          message: 'Cập nhật thông tin nhóm thành công'
        })
      )
    } catch (error) {
      console.error('Error in updateGroupConversation:', error)
      next(error)
    }
  }

  // Thêm phương thức để kiểm tra trạng thái yêu cầu tham gia
  async checkJoinRequestStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.context?.user?._id
      const { conversationId } = req.params

      console.log('Checking join request status for:', { userId, conversationId })

      // Tìm cuộc trò chuyện
      const conversation = await ChatModel.findById(conversationId)
      if (!conversation) {
        throw new AppError({ message: 'Không tìm thấy cuộc trò chuyện', status: 404 })
      }

      // Kiểm tra xem người dùng có trong danh sách pendingRequests không
      const pendingRequest = conversation.pendingRequests?.find(
        (req) => req.userId.toString() === userId?.toString() && req.status === 'PENDING'
      )

      res.json(
        new AppSuccess({
          message: 'Lấy trạng thái yêu cầu tham gia thành công',
          data: { status: pendingRequest ? pendingRequest.status : null }
        })
      )
    } catch (error) {
      next(error)
    }
  }
}

const conversationsController = new ConversationsController()
export default conversationsController
