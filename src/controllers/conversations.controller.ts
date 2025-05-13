import { NextFunction, Request, Response } from 'express'
import status from 'http-status'
import mongoose, { Schema } from 'mongoose'
import { CHAT_TYPE, MESSAGE_STATUS, MESSAGE_TYPE } from '~/constants/enums'
import SOCKET_EVENTS from '~/constants/socket-events'
import { emitSocketEvent } from '~/lib/socket'
import ChatModel from '~/models/chat.model'
import { AppError } from '~/models/error.model'
import MessageModel from '~/models/message.model'
import { AppSuccess } from '~/models/success.model'

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
    const userId = req.context?.user?._id
    const { participants } = req.body

    // Kiểm tra đã có conversation chưa
    let conversation = await ChatModel.findOne({
      participants: { $all: [userId, ...participants], $size: participants.length + 1 }
    })

    if (!conversation) {
      conversation = await ChatModel.create({
        userId,
        participants: [userId, ...participants],
        type: CHAT_TYPE.PRIVATE
      })
    }

    res.json(
      new AppSuccess({ data: conversation, message: 'Create new conversation successfully' })
    )
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
      const { conversationId } = req.params
      const userId = req.context?.user?._id

      console.log('Deleting conversation:', conversationId, 'by user:', userId)

      // Kiểm tra conversationId
      if (!conversationId) {
        return next(
          new AppError({
            status: status.BAD_REQUEST,
            message: 'Conversation ID is required'
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

      // Kiểm tra người dùng có trong cuộc trò chuyện không
      if (
        !conversation.participants.some(
          (participant) => participant.toString() === userId?.toString()
        )
      ) {
        return next(
          new AppError({
            status: status.FORBIDDEN,
            message: 'You are not a participant in this conversation'
          })
        )
      }

      // Xóa cuộc trò chuyện
      await ChatModel.findByIdAndDelete(conversationId)

      // Xóa tất cả tin nhắn trong cuộc trò chuyện
      await MessageModel.deleteMany({ chatId: conversationId })

      // Thông báo cho tất cả người dùng trong cuộc trò chuyện
      emitSocketEvent(conversationId, SOCKET_EVENTS.CONVERSATION_DELETED, {
        conversationId,
        deletedBy: userId
      })

      res.json(
        new AppSuccess({
          data: { conversationId },
          message: 'Conversation deleted successfully'
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
        .populate('participants', 'name avatar')
        .populate({
          path: 'lastMessage',
          populate: {
            path: 'senderId',
            select: 'name avatar'
          }
        })

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
      const { chatId } = req.params
      const userId = req.context?.user?._id

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
      const userId = req.context?.user?._id
      const { participants, name, avatar } = req.body

      // Kiểm tra tên nhóm
      if (!name || name.trim() === '') {
        throw new AppError({ message: 'Tên nhóm không được để trống', status: 400 })
      }

      // Kiểm tra danh sách người tham gia
      if (!participants || !Array.isArray(participants) || participants.length < 2) {
        throw new AppError({ message: 'Nhóm chat phải có ít nhất 2 người tham gia', status: 400 })
      }

      // Tạo nhóm chat mới
      const conversation = await ChatModel.create({
        userId, // Người tạo nhóm
        participants: [userId, ...participants],
        type: CHAT_TYPE.GROUP,
        name,
        avatar
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
      conversation.lastMessage = systemMessage._id as any
      await conversation.save()

      // Thông báo cho tất cả thành viên về nhóm mới
      emitSocketEvent(conversation._id.toString(), SOCKET_EVENTS.GROUP_CREATED, {
        conversation: {
          ...conversation.toObject(),
          lastMessage: systemMessage
        },
        createdBy: userId
      })

      res.json(new AppSuccess({ data: conversation, message: 'Tạo nhóm chat thành công' }))
    } catch (error) {
      console.error('Error in createGroupConversation:', error)
      next(error)
    }
  }
}

const conversationsController = new ConversationsController()
export default conversationsController
