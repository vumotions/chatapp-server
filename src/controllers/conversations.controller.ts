import { v4 } from 'uuid'
import { NextFunction, Request, Response } from 'express'
import mongoose, { Schema, Types } from 'mongoose'
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
import UserModel from '~/models/User.model'

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
            status: 401,
            message: 'User ID is required'
          })
        )
      }

      // Xây dựng query dựa trên filter
      const query: any = {
        participants: userId,
        archivedFor: { $ne: userId } // Không lấy những chat đã được archive bởi người dùng hiện tại
      }

      if (filter === 'unread') {
        query.read = false
        query.lastMessage = { $exists: true } // Chỉ lấy những chat có tin nhắn
      }

      // Thêm điều kiện tìm kiếm nếu có
      if (searchQuery) {
        query.$or = [
          { name: { $regex: searchQuery, $options: 'i' } }
          // Có thể thêm các điều kiện tìm kiếm khác nếu cần
        ]
      }

      console.log('Query for user conversations:', JSON.stringify(query))

      // Đếm tổng số cuộc trò chuyện trước khi phân trang
      const totalCount = await ChatModel.countDocuments(query)
      console.log(`Total conversations count: ${totalCount}`)

      // Tìm tất cả cuộc trò chuyện mà người dùng tham gia với phân trang
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
        .skip(skip)
        .limit(limit)
        .lean() // Convert to plain JavaScript objects

      console.log(`Found ${conversations.length} conversations for page ${page}`)

      // Xử lý dữ liệu trước khi trả về
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

      // Kiểm tra lại một lần nữa để đảm bảo không có chat nào có archived=true
      const filteredConversations = processedConversations.filter((conv) => !conv.archived)

      // Tính toán hasMore dựa trên tổng số cuộc trò chuyện
      const hasMore = totalCount > skip + filteredConversations.length
      console.log(
        `Has more conversations: ${hasMore}, total: ${totalCount}, current: ${skip + filteredConversations.length}`
      )

      // Trả về kết quả
      res.json(
        new AppSuccess({
          data: {
            conversations: filteredConversations,
            hasMore: hasMore,
            total: totalCount
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
    try {
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
            status: 400,
            message: 'Conversation ID is required'
          })
        )
        return
      }

      // Kiểm tra tính hợp lệ của conversationId
      if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        next(
          new AppError({
            status: 400,
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

      // Kiểm tra xem người dùng có xóa lịch sử tin nhắn không
      const deletedMessagesRecord = conversation?.deletedMessagesFor?.find(
        (record) => record.userId.toString() === userId?.toString()
      )

      // Tạo query để lấy tin nhắn
      let messageQuery: any = { chatId: conversationId }

      // Nếu người dùng đã xóa lịch sử, chỉ lấy tin nhắn sau thời điểm xóa
      if (deletedMessagesRecord) {
        messageQuery = {
          ...messageQuery,
          createdAt: { $gt: deletedMessagesRecord.deletedAt }
        }
      }

      // Lấy danh sách tin nhắn của conversation
      const messages = await MessageModel.find(messageQuery)
        .skip(skip)
        .limit(limit)
        .populate('senderId', 'name avatar username')
        .sort({ createdAt: -1 })

      // Kiểm tra xem còn dữ liệu phía sau không
      const totalMessages = await MessageModel.countDocuments(messageQuery)
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
    } catch (error) {
      console.error('Error in getMessagesByConversation:', error)
      next(error)
    }
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
            status: 401,
            message: 'User ID is required'
          })
        )
      }

      if (!participants || !Array.isArray(participants) || participants.length === 0) {
        return next(
          new AppError({
            status: 400,
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
              joinedAt: new Date(),
              isMuted: false,
              mutedUntil: null
            },
            ...participants.map((participantId) => ({
              userId: participantId,
              role: MEMBER_ROLE.MEMBER,
              permissions: {},
              joinedAt: new Date(),
              isMuted: false,
              mutedUntil: null
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
      // Sử dụng updateMany để cập nhật trạng thái
      await MessageModel.updateMany(
        {
          chatId,
          senderId: { $ne: userId }, // Không phải tin nhắn của người dùng hiện tại
          status: { $ne: MESSAGE_STATUS.SEEN } // Chưa được đánh dấu là đã đọc
        },
        {
          $set: { status: MESSAGE_STATUS.SEEN },
          $addToSet: { readBy: userId } // Sử dụng $addToSet thay vì $push để tránh trùng lặp
        }
      )

      // Sau đó, lấy danh sách tin nhắn đã được cập nhật
      const updatedMessages = await MessageModel.find({
        chatId,
        senderId: { $ne: userId },
        status: MESSAGE_STATUS.SEEN,
        readBy: userId
      })
        .select('_id status readBy')
        .lean()

      emitSocketEvent(chatId, SOCKET_EVENTS.MESSAGE_READ, {
        chatId,
        messageIds: updatedMessages.map((msg) => msg._id.toString()),
        readBy: userId,
        messages: updatedMessages.map((msg) => ({
          _id: msg._id.toString(),
          status: msg.status,
          readBy: Array.isArray(msg.readBy) ? msg.readBy.map((id) => id.toString()) : []
        }))
      })

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

      // Tìm tin nhắn
      const message = await MessageModel.findById(messageId)
      console.log('Found message:', message)

      if (!message) {
        return next(
          new AppError({
            status: 404,
            message: 'Không tìm thấy tin nhắn'
          })
        )
      }

      // Tìm cuộc trò chuyện
      const conversation = await ChatModel.findById(message.chatId)
      console.log('Found conversation:', conversation?._id)

      if (!conversation) {
        return next(
          new AppError({
            status: 404,
            message: 'Không tìm thấy cuộc trò chuyện'
          })
        )
      }

      // Kiểm tra xem người dùng có quyền xóa tin nhắn không
      const isMessageSender = message.senderId.toString() === userId?.toString()
      console.log('Is message sender:', isMessageSender)

      // Nếu không phải người gửi tin nhắn, kiểm tra quyền xóa tin nhắn của người khác
      if (!isMessageSender) {
        // Tìm thông tin thành viên
        const member = conversation.members.find(
          (member) => member.userId.toString() === userId?.toString()
        )

        // Kiểm tra xem có phải là owner hoặc admin có quyền xóa tin nhắn không
        const isOwner = member?.role === MEMBER_ROLE.OWNER
        const isAdmin = member?.role === MEMBER_ROLE.ADMIN
        const hasDeletePermission = member?.permissions?.deleteMessages === true

        // Kiểm tra xem người gửi tin nhắn có phải là owner không
        const messageSenderMember = conversation.members.find(
          (member) => member.userId.toString() === message.senderId.toString()
        )
        const isMessageFromOwner = messageSenderMember?.role === MEMBER_ROLE.OWNER

        // Admin không thể xóa tin nhắn của owner
        const canDeleteOthersMessages =
          isOwner || (isAdmin && hasDeletePermission && !isMessageFromOwner)

        if (!canDeleteOthersMessages) {
          return next(
            new AppError({
              status: 403,
              message: 'Bạn không có quyền xóa tin nhắn này'
            })
          )
        }
      }

      // Xóa tin nhắn
      await MessageModel.findByIdAndDelete(messageId)
      console.log('Message deleted successfully')

      // Cập nhật lastMessage của chat nếu tin nhắn bị xóa là tin nhắn cuối cùng
      if (conversation.lastMessage && conversation.lastMessage.toString() === messageId) {
        console.log('Updating lastMessage for chat')
        // Tìm tin nhắn cuối cùng mới
        const lastMessage = await MessageModel.findOne({ chatId: message.chatId })
          .sort({ createdAt: -1 })
          .limit(1)

        // Cập nhật lastMessage
        conversation.lastMessage = lastMessage
          ? (lastMessage._id as unknown as Schema.Types.ObjectId)
          : undefined
        await conversation.save()
        console.log('Chat updated with new lastMessage:', lastMessage?._id)
      }

      // Thông báo cho tất cả người dùng trong chat
      const chatId = message.chatId.toString()
      const eventData = {
        messageId,
        chatId,
        deletedBy: userId,
        isAdminDelete: !isMessageSender
      }

      // Sử dụng hàm helper để gửi sự kiện
      const emitted = emitSocketEvent(chatId, SOCKET_EVENTS.MESSAGE_DELETED, eventData)
      if (emitted) {
        console.log('MESSAGE_DELETED event emitted successfully')
      } else {
        console.error('Failed to emit MESSAGE_DELETED event')
      }

      res.json(
        new AppSuccess({
          data: { messageId },
          message: 'Tin nhắn đã được xóa'
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
            status: 400,
            message: 'Message ID is required'
          })
        )
      }

      if (!content || content.trim() === '') {
        return next(
          new AppError({
            status: 400,
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
            status: 404,
            message: 'Message not found'
          })
        )
      }

      // Kiểm tra người dùng có quyền chỉnh sửa tin nhắn không
      if (message.senderId.toString() !== userId?.toString()) {
        return next(
          new AppError({
            status: 403,
            message: 'You do not have permission to edit this message'
          })
        )
      }

      // Kiểm tra loại tin nhắn (chỉ cho phép chỉnh sửa tin nhắn văn bản)
      if (message.type !== 'TEXT') {
        return next(
          new AppError({
            status: 400,
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
      const emitted = emitSocketEvent(chatId, SOCKET_EVENTS.MESSAGE_UPDATED, eventData)
      if (emitted) {
        console.log('MESSAGE_UPDATED event emitted to room')
        console.log('Emitted event:', SOCKET_EVENTS.MESSAGE_UPDATED)
        console.log('With data:', eventData)
      } else {
        console.error('Failed to emit MESSAGE_UPDATED event')
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
            status: 401,
            message: 'Unauthorized'
          })
        )
        return
      }

      const conversation = await ChatModel.findById(conversationId)
      if (!conversation) {
        next(
          new AppError({
            status: 404,
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
            status: 403,
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
              status: 403,
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
            status: 400,
            message: 'Conversation ID is required'
          })
        )
      }

      // Kiểm tra tính hợp lệ của conversationId
      if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        return next(
          new AppError({
            status: 400,
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
            status: 404,
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
            status: 401,
            message: 'User ID is required'
          })
        )
      }

      // Xây dựng query cho archived chats
      const query: any = {
        participants: userId,
        archivedFor: userId // Tìm các cuộc trò chuyện có userId trong mảng archivedFor
      }

      // Thêm điều kiện tìm kiếm nếu có
      if (searchQuery) {
        query.$or = [
          { name: { $regex: searchQuery, $options: 'i' } }
          // Có thể thêm các điều kiện tìm kiếm khác nếu cần
        ]
      }

      console.log('Query for archived chats:', JSON.stringify(query))

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

      console.log(`Found ${conversations.length} archived conversations`)

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

      // Kiểm tra cuộc trò chuyện tồn tại
      const conversation = await ChatModel.findOne({
        _id: conversationId,
        participants: userId
      })

      if (!conversation) {
        return next(
          new AppError({
            status: 404,
            message: 'Conversation not found'
          })
        )
      }

      console.log('Found conversation to archive:', conversation._id)
      console.log('Current archivedFor:', conversation.archivedFor || [])

      // Cập nhật trường archivedFor để thêm userId
      const updatedConversation = await ChatModel.findOneAndUpdate(
        {
          _id: conversationId,
          participants: userId
        },
        {
          $addToSet: { archivedFor: userId } // Sử dụng $addToSet để tránh trùng lặp
        },
        {
          new: true,
          runValidators: true
        }
      )

      if (!updatedConversation) {
        console.error('Failed to update conversation')
        return next(
          new AppError({
            status: 500,
            message: 'Failed to archive conversation'
          })
        )
      }

      // Log để kiểm tra
      console.log('Updated conversation archivedFor:', updatedConversation.archivedFor || [])

      // Populate dữ liệu cần thiết
      const populatedConversation = await ChatModel.findById(conversationId).populate([
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
          data: populatedConversation,
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
            status: 400,
            message: 'Conversation ID is required'
          })
        )
      }

      // Kiểm tra tính hợp lệ của conversationId
      if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        return next(
          new AppError({
            status: 400,
            message: 'Invalid conversation ID'
          })
        )
      }

      // Tìm và cập nhật cuộc trò chuyện
      const updatedConversation = await ChatModel.findOneAndUpdate(
        {
          _id: conversationId,
          participants: userId
        },
        { $pull: { archivedFor: userId } }, // Xóa userId khỏi mảng archivedFor
        {
          new: true,
          runValidators: true
        }
      )

      // Kiểm tra cuộc trò chuyện tồn tại
      if (!updatedConversation) {
        return next(
          new AppError({
            status: 404,
            message: 'Conversation not found'
          })
        )
      }

      res.json(
        new AppSuccess({
          message: 'Conversation unarchived successfully',
          data: updatedConversation
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
            status: 404,
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
            status: 403,
            message: 'You do not have permission to pin this message'
          })
        )
      }

      // Kiểm tra loại chat
      const isPrivateChat = chat.type === 'PRIVATE'

      // Nếu là private chat, cho phép cả hai người dùng ghim tin nhắn
      if (isPrivateChat) {
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
        return
      }

      // Nếu là group chat, kiểm tra quyền ghim tin nhắn
      const member = chat.members.find((member) => member.userId.toString() === userId?.toString())

      // Nếu không tìm thấy thông tin thành viên
      if (!member) {
        return next(
          new AppError({
            status: 403,
            message: 'Bạn không phải là thành viên của cuộc trò chuyện này'
          })
        )
      }

      const isOwner = member.role === MEMBER_ROLE.OWNER
      const isAdmin = member.role === MEMBER_ROLE.ADMIN
      const hasPinPermission = member.permissions?.pinMessages === true

      // Kiểm tra xem người gửi tin nhắn có phải là owner không
      const messageSenderMember = chat.members.find(
        (member) => member.userId.toString() === message.senderId.toString()
      )
      const isMessageFromOwner = messageSenderMember?.role === MEMBER_ROLE.OWNER

      // Chỉ owner hoặc admin có quyền pinMessages mới có thể ghim/bỏ ghim tin nhắn
      // Admin không thể ghim/bỏ ghim tin nhắn của owner
      const canPinMessage = isOwner || (isAdmin && hasPinPermission && !isMessageFromOwner)

      // Thành viên thường không có quyền ghim tin nhắn
      if (!canPinMessage) {
        return next(
          new AppError({
            status: 403,
            message: 'Bạn không có quyền ghim/bỏ ghim tin nhắn này'
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

      // Kiểm tra người dùng có trong cuộc trò chuyện không
      const chat = await ChatModel.findOne({
        _id: chatId,
        participants: userId
      })

      if (!chat) {
        return next(
          new AppError({
            status: 403,
            message: 'You are not a participant in this conversation'
          })
        )
      }

      // Kiểm tra xem người dùng đã xóa lịch sử chưa
      const deletedMessagesRecord = chat.deletedMessagesFor?.find(
        (record) => record.userId.toString() === userId?.toString()
      )

      // Tạo query để lấy tin nhắn đã ghim
      let pinnedMessagesQuery: any = {
        chatId,
        isPinned: true
      }

      // Nếu người dùng đã xóa lịch sử, chỉ lấy tin nhắn sau thời điểm xóa
      if (deletedMessagesRecord) {
        pinnedMessagesQuery.createdAt = { $gt: deletedMessagesRecord.deletedAt }
      }

      // Lấy tin nhắn đã ghim và sắp xếp theo thời gian mới nhất
      const pinnedMessages = await MessageModel.find(pinnedMessagesQuery)
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
            joinedAt: new Date(),
            isMuted: false,
            mutedUntil: null
          },
          ...participants.map((participantId) => ({
            userId: participantId,
            role: MEMBER_ROLE.MEMBER,
            permissions: {
              inviteUsers: true
            },
            joinedAt: new Date(),
            isMuted: false,
            mutedUntil: null
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

  // Phương thức cập nhật vai trò thành viên trong nhóm
  async updateGroupMemberRole(req: Request, res: Response, next: NextFunction) {
    try {
      const { conversationId } = req.params
      const { userId: targetUserId, role, permissions, customTitle } = req.body
      const userId = req.context?.user?._id

      // Kiểm tra xem người dùng có quyền thay đổi vai trò không
      const conversation = await ChatModel.findById(conversationId)
      if (!conversation) {
        throw new AppError({ message: 'Không tìm thấy cuộc trò chuyện', status: 404 })
      }

      // Kiểm tra xem người dùng hiện tại có phải là thành viên của nhóm không
      const currentMember = conversation.members.find(
        (member) => member.userId.toString() === userId?.toString()
      )

      if (!currentMember) {
        throw new AppError({ message: 'Bạn không phải là thành viên của nhóm này', status: 403 })
      }

      // Kiểm tra quyền (chỉ OWNER hoặc ADMIN có quyền thay đổi vai trò)
      const isOwner = currentMember.role === MEMBER_ROLE.OWNER
      const isAdmin = isOwner || currentMember.role === MEMBER_ROLE.ADMIN

      if (!isAdmin) {
        throw new AppError({
          message: 'Bạn không có quyền thay đổi vai trò thành viên',
          status: 403
        })
      }

      // Tìm thành viên cần cập nhật
      const targetMember = conversation.members.find(
        (member) => member.userId.toString() === targetUserId
      )

      if (!targetMember) {
        throw new AppError({
          message: 'Không tìm thấy thành viên trong nhóm',
          status: 404
        })
      }

      // Không cho phép thay đổi vai trò của OWNER
      if (targetMember.role === MEMBER_ROLE.OWNER) {
        throw new AppError({
          message: 'Không thể thay đổi vai trò của chủ nhóm',
          status: 403
        })
      }

      // Không cho phép admin thay đổi vai trò của admin khác (chỉ owner có thể làm điều này)
      if (targetMember.role === MEMBER_ROLE.ADMIN && !isOwner) {
        throw new AppError({
          message: 'Chỉ chủ nhóm mới có thể thay đổi vai trò của quản trị viên khác',
          status: 403
        })
      }

      // Nếu không phải OWNER thì kiểm tra quyền thăng cấp người khác lên ADMIN
      if (!isOwner && role === MEMBER_ROLE.ADMIN) {
        // Kiểm tra xem người dùng có quyền thêm admin mới không
        if (!currentMember.permissions?.addNewAdmins) {
          throw new AppError({
            message: 'Bạn không có quyền thăng cấp thành viên lên quản trị viên',
            status: 403
          })
        }

        // Giới hạn quyền khi admin thăng cấp thành viên lên admin mới
        if (permissions) {
          permissions.addNewAdmins = false
          permissions.banUsers = false
          permissions.approveJoinRequests = false
        }
      }

      // Tìm index của thành viên cần cập nhật
      const memberIndex = conversation.members.findIndex(
        (member) => member.userId.toString() === targetUserId
      )

      if (memberIndex !== -1) {
        // Cập nhật trực tiếp vào mảng members
        if (role) {
          conversation.members[memberIndex].role = role
        }
        if (permissions) {
          conversation.members[memberIndex].permissions = permissions
        }
        if (customTitle !== undefined) {
          conversation.members[memberIndex].customTitle = customTitle
        }

        // Lấy thành viên đã cập nhật để trả về
        const updatedMember = conversation.members[memberIndex]

        // Lấy thông tin người dùng được thay đổi vai trò
        const targetUser = await UserModel.findById(targetUserId).select('name')

        // Tạo tin nhắn hệ thống thông báo thay đổi vai trò
        const systemMessage = await MessageModel.create({
          chatId: conversation._id,
          senderId: userId,
          content: `${req.context?.user?.name || 'Người dùng'} đã thay đổi vai trò của ${targetUser?.name || 'thành viên'} thành ${role === MEMBER_ROLE.ADMIN ? 'Quản trị viên' : 'Thành viên thường'}`,
          type: MESSAGE_TYPE.SYSTEM,
          status: MESSAGE_STATUS.DELIVERED
        })

        // Cập nhật lastMessage cho cuộc trò chuyện
        conversation.lastMessage = systemMessage._id as any
        await conversation.save()

        // Thông báo cho tất cả thành viên về thay đổi
        emitSocketEvent(conversationId, SOCKET_EVENTS.MEMBER_ROLE_UPDATED, {
          conversationId,
          userId: targetUserId,
          role,
          permissions: updatedMember.permissions,
          customTitle: updatedMember.customTitle,
          updatedBy: userId,
          message: systemMessage
        })

        res.json(
          new AppSuccess({
            data: {
              member: updatedMember,
              message: systemMessage
            },
            message: 'Cập nhật vai trò thành viên thành công'
          })
        )
      }
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
      const newInviteLink = v4().substring(0, 10)
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

  joinGroupByInviteLink = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.context?.user?._id as Types.ObjectId | string
      const { inviteLink } = req.params

      const conversation = await ChatModel.findOne({ inviteLink })
      if (!conversation) {
        throw new AppError({ message: 'Link mời không hợp lệ hoặc đã hết hạn', status: 404 })
      }

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

      const isPrivateGroup = conversation.groupType === GROUP_TYPE.PRIVATE
      const requiresApproval = isPrivateGroup || conversation.requireApproval

      if (requiresApproval) {
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

        const adminsAndOwners = conversation.members.filter(
          (m) => m.role === MEMBER_ROLE.ADMIN || m.role === MEMBER_ROLE.OWNER
        )

        for (const admin of adminsAndOwners) {
          try {
            const existingNotification = await NotificationModel.findOne({
              userId: admin.userId,
              type: NOTIFICATION_TYPE.JOIN_REQUEST,
              'metadata.conversationId': conversation._id,
              'metadata.invitedBy': userId
            })

            let notification

            if (existingNotification) {
              existingNotification.read = false
              existingNotification.processed = false
              existingNotification.set(
                'content',
                `${req.context?.user?.name || 'Một thành viên'} đã gửi yêu cầu tham gia nhóm ${conversation.name}`
              )
              existingNotification.metadata = {
                conversationId: conversation._id,
                chatName: conversation.name,
                isGroup: true,
                requestingUser: userId
              }
              existingNotification.set('createdAt', new Date())

              await existingNotification.save()
              notification = existingNotification
            } else {
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
              })
            }

            const sender = await UserModel.findById(userId).select('name avatar')

            const notificationToSend = {
              ...notification.toObject(),
              senderId: {
                _id: sender?._id,
                name: sender?.name,
                avatar: sender?.avatar
              }
            }

            emitSocketEvent(
              admin.userId.toString(),
              SOCKET_EVENTS.NOTIFICATION_NEW,
              notificationToSend
            )

            emitSocketEvent(admin.userId.toString(), SOCKET_EVENTS.NEW_JOIN_REQUEST, {
              conversationId: conversation._id,
              invitedBy: userId,
              userIds: [userId],
              notification: notificationToSend
            })
          } catch (error) {
            console.error('Error creating notification:', error)
          }
        }

        for (const admin of adminsAndOwners) {
          emitSocketEvent(admin.userId.toString(), SOCKET_EVENTS.JOIN_REQUEST_RECEIVED, {
            conversationId: conversation._id,
            userId
          })
        }

        res.json(
          new AppSuccess({
            data: { conversationId: conversation._id, pending: true },
            message: 'Yêu cầu tham gia của bạn đã được gửi và đang chờ phê duyệt'
          })
        )
        return
      } else {
        // Public group – join immediately
        conversation.members.push({
          userId: new Types.ObjectId(userId.toString()) as unknown as Schema.Types.ObjectId,
          role: MEMBER_ROLE.MEMBER,
          permissions: {
            inviteUsers: true
          },
          joinedAt: new Date(),
          isMuted: false,
          mutedUntil: null
        })

        if (!conversation.participants.some((p) => p.toString() === userId.toString())) {
          conversation.participants.push(
            new Types.ObjectId(userId.toString()) as unknown as Schema.Types.ObjectId
          )
        }

        await conversation.save()

        const user = await UserModel.findById(userId).select('name')
        const systemMessage = await MessageModel.create({
          chatId: conversation._id,
          senderId: userId,
          content: `${user?.name || 'Người dùng'} đã tham gia nhóm`,
          type: MESSAGE_TYPE.SYSTEM,
          status: MESSAGE_STATUS.DELIVERED
        })

        conversation.lastMessage = systemMessage._id as unknown as Schema.Types.ObjectId
        await conversation.save()

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
      const { status } = req.query // Thêm tham số status để lọc theo trạng thái

      console.log('Getting join requests for conversation:', conversationId, 'with status:', status)

      // Kiểm tra quyền
      const conversation = await ChatModel.findById(conversationId)
        .populate('pendingRequests.userId', 'name avatar username')
        .populate('pendingRequests.invitedBy', 'name avatar username')
        .populate('pendingRequests.processedBy', 'name avatar username')

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

      // Lọc yêu cầu theo trạng thái nếu có
      let requests = conversation.pendingRequests || []

      if (status) {
        requests = requests.filter((req) => req.status === status)
      }

      // Trả về danh sách yêu cầu tham gia đã được lọc
      res.json(
        new AppSuccess({
          message: 'Lấy danh sách yêu cầu tham gia thành công',
          data: requests
        })
      )
    } catch (error) {
      console.error('Error in getJoinRequests:', error)
      next(error)
    }
  }

  // Phê duyệt yêu cầu tham gia
  async approveJoinRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const { conversationId, userId } = req.params
      const currentUserId = req.context?.user?._id

      console.log(`Approving join request for user ${userId} in conversation ${conversationId}`)

      // Tìm cuộc trò chuyện
      const conversation = await ChatModel.findById(conversationId)
      if (!conversation) {
        return next(
          new AppError({
            status: 404,
            message: 'Conversation not found'
          })
        )
      }

      // Kiểm tra quyền phê duyệt
      const currentMember = conversation.members.find(
        (member) => member.userId.toString() === currentUserId?.toString()
      )

      if (!currentMember) {
        return next(
          new AppError({
            status: 403,
            message: 'You are not a member of this conversation'
          })
        )
      }

      // Kiểm tra quyền phê duyệt
      const canApprove =
        currentMember.role === MEMBER_ROLE.OWNER ||
        (currentMember.role === MEMBER_ROLE.ADMIN && currentMember.permissions?.approveJoinRequests)

      if (!canApprove) {
        return next(
          new AppError({
            status: 403,
            message: 'You do not have permission to approve join requests'
          })
        )
      }

      // Đảm bảo pendingRequests tồn tại
      if (!conversation.pendingRequests) {
        conversation.pendingRequests = []
      }

      // Kiểm tra xem người dùng đã là thành viên chưa
      const isAlreadyMember = conversation.members.some(
        (member) => member.userId.toString() === userId
      )

      if (isAlreadyMember) {
        // Cập nhật tất cả yêu cầu PENDING của người dùng thành APPROVED
        await ChatModel.updateMany(
          {
            _id: conversationId,
            pendingRequests: {
              $elemMatch: {
                userId: new mongoose.Types.ObjectId(userId),
                status: JOIN_REQUEST_STATUS.PENDING
              }
            }
          },
          {
            $set: {
              'pendingRequests.$[elem].status': JOIN_REQUEST_STATUS.APPROVED,
              'pendingRequests.$[elem].processedAt': new Date(),
              'pendingRequests.$[elem].processedBy': currentUserId
            }
          },
          {
            arrayFilters: [
              {
                'elem.userId': new mongoose.Types.ObjectId(userId),
                'elem.status': JOIN_REQUEST_STATUS.PENDING
              }
            ]
          }
        )

        // Lấy lại conversation sau khi cập nhật
        const updatedConversation = await ChatModel.findById(conversationId)
          .populate('pendingRequests.userId', 'name avatar username')
          .populate('pendingRequests.invitedBy', 'name avatar username')
          .populate('pendingRequests.processedBy', 'name avatar username')

        res.json(
          new AppSuccess({
            message: 'User is already a member of this conversation',
            data: {
              conversation: updatedConversation,
              alreadyMember: true
            }
          })
        )
        return
      }

      // Cập nhật tất cả yêu cầu PENDING của người dùng thành APPROVED
      await ChatModel.updateMany(
        {
          _id: conversationId,
          pendingRequests: {
            $elemMatch: {
              userId: new mongoose.Types.ObjectId(userId),
              status: JOIN_REQUEST_STATUS.PENDING
            }
          }
        },
        {
          $set: {
            'pendingRequests.$[elem].status': JOIN_REQUEST_STATUS.APPROVED,
            'pendingRequests.$[elem].processedAt': new Date(),
            'pendingRequests.$[elem].processedBy': currentUserId
          }
        },
        {
          arrayFilters: [
            {
              'elem.userId': new mongoose.Types.ObjectId(userId),
              'elem.status': JOIN_REQUEST_STATUS.PENDING
            }
          ]
        }
      )

      // Thêm người dùng vào nhóm
      await ChatModel.updateOne(
        { _id: conversationId },
        {
          $push: {
            members: {
              userId: new mongoose.Types.ObjectId(userId),
              role: MEMBER_ROLE.MEMBER,
              permissions: {
                inviteUsers: true
              },
              joinedAt: new Date(),
              isMuted: false,
              mutedUntil: null
            }
          },
          $addToSet: {
            participants: new mongoose.Types.ObjectId(userId)
          }
        }
      )

      // Lấy lại conversation sau khi cập nhật
      const updatedConversation = await ChatModel.findById(conversationId)
        .populate('pendingRequests.userId', 'name avatar username')
        .populate('pendingRequests.invitedBy', 'name avatar username')
        .populate('pendingRequests.processedBy', 'name avatar username')

      if (!updatedConversation) {
        return next(
          new AppError({
            status: 404,
            message: 'Conversation not found after update'
          })
        )
      }

      // Tạo tin nhắn hệ thống - sử dụng Promise.all để tối ưu
      const [user, approver] = await Promise.all([
        UserModel.findById(userId).select('name'),
        UserModel.findById(currentUserId).select('name')
      ])

      const systemMessage = await MessageModel.create({
        chatId: conversationId,
        senderId: currentUserId,
        content: `${user?.name || 'Người dùng'} đã được ${approver?.name || 'Quản trị viên'} chấp nhận vào nhóm`,
        type: MESSAGE_TYPE.SYSTEM,
        status: MESSAGE_STATUS.DELIVERED
      })

      // Cập nhật lastMessage
      await ChatModel.updateOne({ _id: conversationId }, { lastMessage: systemMessage._id })

      // Lấy thông tin đầy đủ của tin nhắn để gửi qua socket
      const messageToSend = await MessageModel.findById(systemMessage._id).lean().exec()

      // Thông báo cho tất cả thành viên
      emitSocketEvent(conversationId.toString(), SOCKET_EVENTS.JOIN_REQUEST_APPROVED, {
        conversationId,
        userId,
        approvedBy: currentUserId,
        message: messageToSend || systemMessage.toObject()
      })

      res.json(
        new AppSuccess({
          message: 'Join request approved successfully',
          data: {
            conversation: updatedConversation,
            message: systemMessage
          }
        })
      )
    } catch (error) {
      console.error('Error approving join request:', error)
      next(error)
    }
  }

  // Từ chối yêu cầu tham gia
  async rejectJoinRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const { conversationId, userId } = req.params
      const currentUserId = req.context?.user?._id

      // Tìm cuộc trò chuyện
      const conversation = await ChatModel.findById(conversationId)
      if (!conversation) {
        return next(
          new AppError({
            status: 404,
            message: 'Conversation not found'
          })
        )
      }

      // Kiểm tra xem người dùng hiện tại có quyền từ chối không
      const currentMember = conversation.members.find(
        (member) => member.userId.toString() === currentUserId?.toString()
      )

      if (!currentMember) {
        return next(
          new AppError({
            status: 403,
            message: 'You are not a member of this conversation'
          })
        )
      }

      // Kiểm tra quyền từ chối
      const canReject =
        currentMember.role === MEMBER_ROLE.OWNER ||
        currentMember.role === MEMBER_ROLE.ADMIN ||
        currentMember.permissions?.approveJoinRequests

      if (!canReject) {
        return next(
          new AppError({
            status: 403,
            message: 'You do not have permission to reject join requests'
          })
        )
      }

      // Đảm bảo pendingRequests tồn tại
      if (!conversation.pendingRequests) {
        conversation.pendingRequests = []
      }

      // Cập nhật tất cả yêu cầu PENDING của người dùng thành REJECTED
      await ChatModel.updateMany(
        { _id: conversationId },
        {
          $pull: {
            pendingRequests: {
              userId: new mongoose.Types.ObjectId(userId)
            }
          }
        }
      )

      // Thêm một yêu cầu mới với trạng thái REJECTED
      await ChatModel.updateOne(
        { _id: conversationId },
        {
          $push: {
            pendingRequests: {
              userId: new mongoose.Types.ObjectId(userId),
              requestedAt: new Date(),
              status: JOIN_REQUEST_STATUS.REJECTED,
              processedAt: new Date(),
              processedBy: currentUserId
            }
          }
        }
      )

      // Lấy lại conversation sau khi cập nhật
      const updatedConversation = await ChatModel.findById(conversationId)
        .populate('pendingRequests.userId', 'name avatar username')
        .populate('pendingRequests.invitedBy', 'name avatar username')
        .populate('pendingRequests.processedBy', 'name avatar username')

      // Thông báo cho tất cả thành viên
      emitSocketEvent(conversationId.toString(), SOCKET_EVENTS.JOIN_REQUEST_REJECTED, {
        conversationId,
        userId,
        rejectedBy: currentUserId
      })

      res.json(
        new AppSuccess({
          message: 'Join request rejected successfully',
          data: {
            conversation: updatedConversation
          }
        })
      )
    } catch (error) {
      console.error('Error rejecting join request:', error)
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
            status: 400,
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
            status: 404,
            message: 'Conversation not found'
          })
        )
      }

      // Kiểm tra người dùng hiện tại có quyền xóa thành viên không
      const currentMember = conversation.members.find(
        (member) => member.userId.toString() === currentUserId?.toString()
      )

      if (!currentMember) {
        return next(
          new AppError({
            status: 403,
            message: 'You are not a member of this group'
          })
        )
      }

      const isOwner = currentMember.role === MEMBER_ROLE.OWNER
      const isAdmin = currentMember.role === MEMBER_ROLE.ADMIN
      const canRemoveMembers = isOwner || (isAdmin && currentMember.permissions?.banUsers)

      if (!canRemoveMembers) {
        return next(
          new AppError({
            status: 403,
            message: 'You do not have permission to remove members from this group'
          })
        )
      }

      // Không cho phép xóa chính mình
      if (memberIdToRemove === currentUserId?.toString()) {
        return next(
          new AppError({
            status: 400,
            message: 'Cannot remove yourself from the group. Use the leave group function instead.'
          })
        )
      }

      // Không cho phép admin xóa owner
      const memberToRemove = conversation.members.find(
        (member) => member.userId.toString() === memberIdToRemove
      )

      if (memberToRemove?.role === MEMBER_ROLE.OWNER && !isOwner) {
        return next(
          new AppError({
            status: 403,
            message: 'Admins cannot remove the group owner'
          })
        )
      }

      // Không cho phép admin xóa admin khác (chỉ owner có thể xóa admin)
      if (memberToRemove?.role === MEMBER_ROLE.ADMIN && !isOwner) {
        return next(
          new AppError({
            status: 403,
            message: 'Admins cannot remove other admins'
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
            status: 400,
            message: 'User is not a member of this group'
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

      // Lấy thông tin người dùng bị xóa và người xóa
      const [removedUser, currentUser] = await Promise.all([
        UserModel.findById(memberIdToRemove).select('name'),
        UserModel.findById(currentUserId).select('name')
      ])

      // Tạo tin nhắn hệ thống thông báo thành viên bị xóa
      const systemMessage = await MessageModel.create({
        chatId: conversation._id,
        senderId: currentUserId,
        content: `${currentUser?.name || 'Quản trị viên'} đã xóa ${removedUser?.name || 'Thành viên'} khỏi nhóm`,
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
            status: 400,
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
            status: 404,
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
            status: 403,
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
            status: 403,
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
            status: 400,
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
            })

            let notification

            if (existingNotification) {
              // Nếu đã có thông báo, cập nhật lại thay vì tạo mới
              existingNotification.read = false
              existingNotification.processed = false
              existingNotification.set(
                'content',
                `${inviter?.name || 'Một thành viên'} đã mời ${newPendingUserIds.length} người vào nhóm ${conversation.name || 'của bạn'}`
              )
              existingNotification.metadata = {
                conversationId: conversation._id,
                chatName: conversation.name || 'Nhóm chat',
                invitedBy: userId,
                userIds: newPendingUserIds,
                timestamp: new Date() // Thêm timestamp mới
              }
              // Cập nhật thời gian tạo để đưa thông báo lên đầu
              existingNotification.set('createdAt', new Date())

              await existingNotification.save()
              notification = existingNotification
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
              })
            }

            // Lấy thông tin người gửi để gửi kèm thông báo
            const sender = await UserModel.findById(userId).select('name avatar')

            // Chuẩn bị thông báo để gửi qua socket
            const notificationToSend = {
              ...notification.toObject(),
              senderId: {
                _id: sender?._id,
                name: sender?.name,
                avatar: sender?.avatar
              }
            }

            emitSocketEvent(
              admin.userId.toString(),
              SOCKET_EVENTS.NOTIFICATION_NEW,
              notificationToSend
            )

            // Gửi thêm sự kiện NEW_JOIN_REQUEST để đảm bảo tương thích
            emitSocketEvent(admin.userId.toString(), SOCKET_EVENTS.NEW_JOIN_REQUEST, {
              conversationId: conversation._id,
              invitedBy: userId,
              userIds: newPendingUserIds,
              notification: notificationToSend // Gửi kèm thông báo đầy đủ
            })
          } catch (error) {
            console.error('Error creating notification:', error)
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
        joinedAt: new Date(),
        isMuted: false,
        mutedUntil: null
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
          status: 404,
          message: 'Cuộc trò chuyện không tồn tại hoặc đã bị xóa'
        })
      }

      // Kiểm tra xem người dùng có trong danh sách participants không
      const isParticipant = conversation.participants.some(
        (p) => p.toString() === userId.toString()
      )

      if (!isParticipant) {
        throw new AppError({
          status: 403,
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
            status: 400,
            message: 'Vui lòng chọn thành viên để chuyển quyền chủ nhóm'
          })
        )
      }

      // Tìm cuộc trò chuyện
      const conversation = await ChatModel.findById(conversationId)
      if (!conversation) {
        return next(
          new AppError({
            status: 404,
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
            status: 403,
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
            status: 400,
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

      if (!member) {
        throw new AppError({ message: 'Bạn không phải là thành viên của nhóm này', status: 403 })
      }

      // Sửa lại điều kiện kiểm tra quyền
      const canChangeInfo =
        member.role === MEMBER_ROLE.OWNER ||
        (member.role === MEMBER_ROLE.ADMIN && member.permissions?.changeGroupInfo)

      if (!canChangeInfo) {
        throw new AppError({
          message: 'Bạn không có quyền thay đổi thông tin nhóm',
          status: 403
        })
      }

      // Lưu thông tin cũ để so sánh
      const oldName = conversation.name
      const oldAvatar = conversation.avatar
      const oldGroupType = conversation.groupType
      const oldRequireApproval = conversation.requireApproval

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

      // Tạo tin nhắn hệ thống thông báo thay đổi
      const user = await UserModel.findById(userId).select('name')
      let systemMessageContent = `${user?.name || 'Người dùng'} đã cập nhật thông tin nhóm`

      // Thêm chi tiết về những thay đổi cụ thể
      const changes = []
      if (name && name !== oldName) {
        changes.push(`tên nhóm thành "${name}"`)
      }
      if (avatar && avatar !== oldAvatar) {
        changes.push('ảnh đại diện nhóm')
      }
      if (groupType && groupType !== oldGroupType) {
        changes.push(
          `loại nhóm thành ${groupType === GROUP_TYPE.PRIVATE ? 'riêng tư' : 'công khai'}`
        )
      }
      if (
        requireApproval !== undefined &&
        requireApproval !== oldRequireApproval &&
        groupType !== GROUP_TYPE.PRIVATE
      ) {
        changes.push(`${requireApproval ? 'bật' : 'tắt'} yêu cầu phê duyệt khi tham gia`)
      }

      // Nếu có thay đổi cụ thể, thêm vào nội dung tin nhắn
      if (changes.length > 0) {
        systemMessageContent = `${user?.name || 'Người dùng'} đã thay đổi ${changes.join(', ')}`
      }

      // Tạo tin nhắn hệ thống
      const systemMessage = await MessageModel.create({
        chatId: conversation._id,
        senderId: userId,
        content: systemMessageContent,
        type: MESSAGE_TYPE.SYSTEM,
        status: MESSAGE_STATUS.DELIVERED
      })

      // Cập nhật lastMessage cho cuộc trò chuyện
      conversation.lastMessage = systemMessage._id as Schema.Types.ObjectId
      await conversation.save()

      // Thông báo cho tất cả thành viên về thay đổi
      emitSocketEvent(String(conversation._id), SOCKET_EVENTS.GROUP_UPDATED, {
        conversationId: conversation._id,
        type: 'GROUP_UPDATED',
        updatedBy: userId,
        message: systemMessage
      })

      res.json(
        new AppSuccess({
          data: {
            ...conversation.toObject(),
            lastMessage: systemMessage
          },
          message: 'Cập nhật thông tin nhóm thành công'
        })
      )
    } catch (error) {
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

  // Cấm/cho phép thành viên chat trong nhóm
  async muteGroupMember(req: Request, res: Response, next: NextFunction) {
    try {
      const { conversationId, userId: memberIdToMute } = req.params
      const { duration } = req.body // Thời gian cấm chat tính bằng phút, 0 = vô thời hạn
      const currentUserId = req.context?.user?._id

      // Kiểm tra conversationId
      if (!conversationId || !memberIdToMute) {
        return next(
          new AppError({
            status: 400,
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
            status: 404,
            message: 'Conversation not found'
          })
        )
      }

      // Kiểm tra người dùng hiện tại có quyền cấm chat không
      const currentMember = conversation.members.find(
        (member) => member.userId.toString() === currentUserId?.toString()
      )

      if (!currentMember) {
        return next(
          new AppError({
            status: 403,
            message: 'You are not a member of this group'
          })
        )
      }

      const isOwner = currentMember.role === MEMBER_ROLE.OWNER
      const isAdmin = currentMember.role === MEMBER_ROLE.ADMIN
      const canBanUsers = isOwner || (isAdmin && currentMember.permissions?.banUsers)

      if (!canBanUsers) {
        return next(
          new AppError({
            status: 403,
            message: 'You do not have permission to mute members in this group'
          })
        )
      }

      // Không cho phép cấm chat chính mình
      if (memberIdToMute === currentUserId?.toString()) {
        return next(
          new AppError({
            status: 400,
            message: 'Cannot mute yourself'
          })
        )
      }

      // Không cho phép admin cấm chat owner
      const memberToMute = conversation.members.find(
        (member) => member.userId.toString() === memberIdToMute
      )

      if (!memberToMute) {
        return next(
          new AppError({
            status: 400,
            message: 'User is not a member of this group'
          })
        )
      }

      if (memberToMute.role === MEMBER_ROLE.OWNER) {
        return next(
          new AppError({
            status: 403,
            message: 'Cannot mute the group owner'
          })
        )
      }

      // Không cho phép admin cấm chat admin khác (chỉ owner có thể cấm chat admin)
      if (memberToMute.role === MEMBER_ROLE.ADMIN && !isOwner) {
        return next(
          new AppError({
            status: 403,
            message: 'Admins cannot mute other admins'
          })
        )
      }

      // Tính thời gian hết hạn cấm chat
      let mutedUntil = null
      if (duration && duration > 0) {
        mutedUntil = new Date()
        mutedUntil.setMinutes(mutedUntil.getMinutes() + duration)
      }

      // Cập nhật trạng thái cấm chat
      await ChatModel.updateOne(
        {
          _id: conversationId,
          'members.userId': memberIdToMute
        },
        {
          $set: {
            'members.$.isMuted': true,
            'members.$.mutedUntil': mutedUntil
          }
        }
      )

      // Lấy thông tin người dùng bị cấm chat
      const mutedUser = await UserModel.findById(memberIdToMute).select('name')

      // Tạo tin nhắn hệ thống thông báo
      const muteMessage =
        duration && duration > 0
          ? `${mutedUser?.name || 'Thành viên'} đã bị cấm chat trong ${duration} phút`
          : `${mutedUser?.name || 'Thành viên'} đã bị cấm chat vô thời hạn`

      const systemMessage = await MessageModel.create({
        chatId: conversation._id,
        senderId: currentUserId,
        content: muteMessage,
        type: MESSAGE_TYPE.SYSTEM,
        status: MESSAGE_STATUS.DELIVERED
      })

      // Cập nhật lastMessage
      conversation.lastMessage = systemMessage._id as unknown as Schema.Types.ObjectId
      await conversation.save()

      // Thông báo cho tất cả thành viên trong nhóm
      emitSocketEvent(conversationId, SOCKET_EVENTS.MEMBER_MUTED, {
        conversationId,
        mutedUserId: memberIdToMute,
        mutedBy: currentUserId,
        mutedUntil: mutedUntil,
        message: systemMessage.toObject()
      })

      res.json(
        new AppSuccess({
          data: {
            conversationId,
            mutedUserId: memberIdToMute,
            mutedUntil: mutedUntil
          },
          message: 'Member muted successfully'
        })
      )
    } catch (error) {
      console.error('Error muting group member:', error)
      next(error)
    }
  }

  // Bỏ cấm chat thành viên
  async unmuteGroupMember(req: Request, res: Response, next: NextFunction) {
    try {
      const { conversationId, userId: memberIdToUnmute } = req.params
      const currentUserId = req.context?.user?._id

      // Tìm cuộc trò chuyện
      const conversation = await ChatModel.findById(conversationId)
      if (!conversation) {
        return next(
          new AppError({
            status: 404,
            message: 'Conversation not found'
          })
        )
      }

      // Kiểm tra quyền
      const currentMember = conversation.members.find(
        (member) => member.userId.toString() === currentUserId?.toString()
      )

      if (!currentMember) {
        return next(
          new AppError({
            status: 403,
            message: 'You are not a member of this group'
          })
        )
      }

      const isOwner = currentMember.role === MEMBER_ROLE.OWNER
      const isAdmin = currentMember.role === MEMBER_ROLE.ADMIN
      const canBanUsers = isOwner || (isAdmin && currentMember.permissions?.banUsers)

      if (!canBanUsers) {
        return next(
          new AppError({
            status: 403,
            message: 'You do not have permission to unmute members in this group'
          })
        )
      }

      // Cập nhật trạng thái cấm chat
      await ChatModel.updateOne(
        {
          _id: conversationId,
          'members.userId': memberIdToUnmute
        },
        {
          $set: {
            'members.$.isMuted': false,
            'members.$.mutedUntil': null
          }
        }
      )

      // Lấy thông tin người dùng
      const unmutedUser = await UserModel.findById(memberIdToUnmute).select('name')

      // Tạo tin nhắn hệ thống
      const systemMessage = await MessageModel.create({
        chatId: conversation._id,
        senderId: currentUserId,
        content: `${unmutedUser?.name || 'Thành viên'} đã được bỏ cấm chat`,
        type: MESSAGE_TYPE.SYSTEM,
        status: MESSAGE_STATUS.DELIVERED
      })

      // Cập nhật lastMessage
      conversation.lastMessage = systemMessage._id as unknown as Schema.Types.ObjectId
      await conversation.save()

      // Thông báo cho tất cả thành viên
      emitSocketEvent(conversationId, SOCKET_EVENTS.MEMBER_UNMUTED, {
        conversationId,
        unmutedUserId: memberIdToUnmute,
        unmutedBy: currentUserId,
        message: systemMessage.toObject()
      })

      res.json(
        new AppSuccess({
          data: { conversationId, unmutedUserId: memberIdToUnmute },
          message: 'Member unmuted successfully'
        })
      )
    } catch (error) {
      console.error('Error unmuting group member:', error)
      next(error)
    }
  }

  // Thêm phương thức để kiểm tra trạng thái cấm chat của người dùng
  async checkUserMuteStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.context?.user?._id
      const { chatId } = req.params

      // Kiểm tra chatId
      if (!chatId) {
        next(
          new AppError({
            status: 400,
            message: 'Chat ID is required'
          })
        )
        return
      }

      // Tìm cuộc trò chuyện
      const conversation = await ChatModel.findById(chatId)
      if (!conversation) {
        next(
          new AppError({
            status: 404,
            message: 'Conversation not found'
          })
        )
        return
      }

      // Kiểm tra xem người dùng có trong cuộc trò chuyện không
      const isMember = conversation.participants.some(
        (participant) => participant.toString() === userId?.toString()
      )

      if (!isMember) {
        next(
          new AppError({
            status: 403,
            message: 'You are not a member of this conversation'
          })
        )
        return
      }

      // Kiểm tra xem người dùng có bị cấm chat không
      const member = conversation.members.find(
        (member) => member.userId.toString() === userId?.toString()
      )

      // Nếu người dùng bị cấm chat
      if (member?.isMuted) {
        // Kiểm tra thời hạn cấm chat
        if (!member.mutedUntil || new Date() < new Date(member.mutedUntil)) {
          // Vẫn trong thời gian bị cấm
          res.json(
            new AppSuccess({
              message: 'User is muted in this conversation',
              data: {
                isMuted: true,
                mutedUntil: member.mutedUntil,
                canSendMessages: false,
                conversationId: chatId
              }
            })
          )
          return
        } else {
          // Đã hết thời hạn cấm chat, tự động bỏ cấm
          await ChatModel.updateOne(
            { _id: chatId, 'members.userId': userId },
            { $set: { 'members.$.isMuted': false, 'members.$.mutedUntil': null } }
          )
        }
      }

      // Nếu không bị cấm chat hoặc đã hết thời hạn
      res.json(
        new AppSuccess({
          message: 'User can send messages in this conversation',
          data: {
            isMuted: false,
            mutedUntil: null,
            canSendMessages: true,
            conversationId: chatId
          }
        })
      )
    } catch (error) {
      console.error('Error checking mute status:', error)
      next(error)
    }
  }

  // Thêm phương thức xóa tất cả yêu cầu tham gia theo trạng thái
  async deleteAllJoinRequests(req: Request, res: Response, next: NextFunction) {
    try {
      const { conversationId } = req.params
      const requestStatus = req.query.status as string
      const userId = req.context?.user?._id

      console.log('Deleting all join requests:', { conversationId, requestStatus, userId })

      // Kiểm tra xem requestStatus có hợp lệ không
      if (!requestStatus || !['PENDING', 'APPROVED', 'REJECTED'].includes(requestStatus)) {
        return next(
          new AppError({
            status: 400,
            message: 'Trạng thái không hợp lệ'
          })
        )
      }

      // Kiểm tra xem cuộc trò chuyện có tồn tại không
      const conversation = await ChatModel.findById(conversationId)
      if (!conversation) {
        return next(
          new AppError({
            status: 404,
            message: 'Không tìm thấy cuộc trò chuyện'
          })
        )
      }

      // Kiểm tra xem người dùng có quyền xóa không (phải là admin hoặc chủ nhóm)
      const member = conversation.members.find(
        (member) => member.userId.toString() === userId?.toString()
      )

      if (!member) {
        return next(
          new AppError({
            status: 403,
            message: 'Bạn không phải là thành viên của nhóm này'
          })
        )
      }

      const isAdmin = member.role === MEMBER_ROLE.ADMIN
      const isOwner = member.role === MEMBER_ROLE.OWNER
      const canManageRequests = isOwner || (isAdmin && member.permissions?.approveJoinRequests)

      if (!canManageRequests) {
        return next(
          new AppError({
            status: 403,
            message: 'Bạn không có quyền thực hiện hành động này'
          })
        )
      }

      // Lọc các yêu cầu tham gia theo trạng thái
      if (!conversation.pendingRequests) {
        conversation.pendingRequests = []
      }

      // Đếm số lượng yêu cầu trước khi xóa
      const requestsToDelete = conversation.pendingRequests.filter(
        (req) => req.status === requestStatus
      ).length

      // Xóa tất cả yêu cầu tham gia theo trạng thái
      conversation.pendingRequests = conversation.pendingRequests.filter(
        (req) => req.status !== requestStatus
      )

      await conversation.save()

      res.json(
        new AppSuccess({
          message: `Đã xóa ${requestsToDelete} yêu cầu tham gia có trạng thái ${requestStatus}`,
          data: {
            conversationId,
            status: requestStatus,
            deletedCount: requestsToDelete
          }
        })
      )
    } catch (error) {
      console.error('Error deleting join requests:', error)
      next(error)
    }
  }

  // Thêm phương thức mới sau phương thức transferOwnership và trước khi kết thúc class

  // Cập nhật cài đặt "Chỉ owner và admin được gửi tin nhắn"
  async updateSendMessageRestriction(req: Request, res: Response, next: NextFunction) {
    try {
      const { conversationId } = req.params
      const { onlyAdminsCanSend, duration } = req.body
      const userId = req.context?.user?._id

      console.log('Received request:', { conversationId, onlyAdminsCanSend, duration })

      // Tìm cuộc trò chuyện
      const conversation = await ChatModel.findById(conversationId)
      if (!conversation) {
        return next(
          new AppError({
            status: 404,
            message: 'Không tìm thấy cuộc trò chuyện'
          })
        )
      }

      // Kiểm tra quyền
      const member = conversation.members.find((m) => m.userId.toString() === userId?.toString())
      if (!member) {
        return next(
          new AppError({
            status: 403,
            message: 'Bạn không phải là thành viên của nhóm này'
          })
        )
      }

      // Chỉ owner mới có quyền cập nhật cài đặt tin nhắn
      const isOwner = member.role === MEMBER_ROLE.OWNER
      if (!isOwner) {
        return next(
          new AppError({
            status: 403,
            message: 'Chỉ chủ nhóm mới có quyền thay đổi cài đặt này'
          })
        )
      }

      // Cập nhật cài đặt
      conversation.onlyAdminsCanSend = onlyAdminsCanSend

      // Xử lý restrictUntil dựa trên duration
      if (onlyAdminsCanSend && duration && duration > 0) {
        // Tạo thời gian hết hạn bằng cách thêm duration phút vào thời gian hiện tại
        const restrictUntil = new Date()
        restrictUntil.setMinutes(restrictUntil.getMinutes() + duration)
        conversation.restrictUntil = restrictUntil
        console.log('Setting restrictUntil to:', restrictUntil)
      } else {
        // Nếu không có duration hoặc duration <= 0, đặt restrictUntil = null (vô thời hạn)
        conversation.restrictUntil = null
        console.log('Setting restrictUntil to null')
      }

      await conversation.save()

      // Tạo tin nhắn hệ thống
      const user = await UserModel.findById(userId).select('name')
      let systemMessage

      if (onlyAdminsCanSend) {
        const durationText = conversation.restrictUntil
          ? `đến ${new Date(conversation.restrictUntil).toLocaleString('vi-VN')}`
          : 'cho đến khi có thay đổi'

        systemMessage = await MessageModel.create({
          chatId: conversation._id,
          senderId: userId,
          content: `${user?.name || 'Chủ nhóm'} đã bật chế độ "Chỉ quản trị viên được gửi tin nhắn" ${durationText}`,
          type: MESSAGE_TYPE.SYSTEM,
          status: MESSAGE_STATUS.DELIVERED
        })
      } else {
        systemMessage = await MessageModel.create({
          chatId: conversation._id,
          senderId: userId,
          content: `${user?.name || 'Chủ nhóm'} đã tắt chế độ "Chỉ quản trị viên được gửi tin nhắn"`,
          type: MESSAGE_TYPE.SYSTEM,
          status: MESSAGE_STATUS.DELIVERED
        })
      }

      // Cập nhật lastMessage
      conversation.lastMessage = systemMessage._id as unknown as Schema.Types.ObjectId
      await conversation.save()

      // Thông báo cho tất cả thành viên
      emitSocketEvent(conversationId, SOCKET_EVENTS.GROUP_SETTINGS_UPDATED, {
        conversationId,
        onlyAdminsCanSend,
        restrictUntil: conversation.restrictUntil,
        updatedBy: userId,
        message: systemMessage
      })

      res.json(
        new AppSuccess({
          message: 'Đã cập nhật cài đặt nhóm thành công',
          data: {
            conversationId,
            onlyAdminsCanSend,
            restrictUntil: conversation.restrictUntil
          }
        })
      )
    } catch (error) {
      console.error('Error updating send message restriction:', error)
      next(error)
    }
  }

  // Kiểm tra quyền gửi tin nhắn
  async checkSendMessagePermission(req: Request, res: Response, next: NextFunction) {
    try {
      const { chatId } = req.params
      const userId = req.context?.user?._id

      // Tìm cuộc trò chuyện
      const chat = await ChatModel.findById(chatId)
      if (!chat) {
        return next(
          new AppError({
            status: 404,
            message: 'Không tìm thấy cuộc trò chuyện'
          })
        )
      }

      // Kiểm tra người dùng có trong cuộc trò chuyện không
      const isMember = chat.participants.some((p) => p.toString() === userId?.toString())
      if (!isMember) {
        return next(
          new AppError({
            status: 403,
            message: 'Bạn không phải là thành viên của cuộc trò chuyện này'
          })
        )
      }

      // Tìm thông tin thành viên
      const member = chat.members.find((m) => m.userId.toString() === userId?.toString())
      if (!member) {
        return next(
          new AppError({
            status: 403,
            message: 'Không tìm thấy thông tin thành viên'
          })
        )
      }

      // Kiểm tra vai trò của thành viên
      const isOwnerOrAdmin = member.role === MEMBER_ROLE.OWNER || member.role === MEMBER_ROLE.ADMIN

      // 1. Kiểm tra chế độ "Chỉ owner và admin được gửi tin nhắn" (cài đặt nhóm)
      let restrictedByGroupSettings = false
      let restrictUntil = null

      if (chat.onlyAdminsCanSend) {
        // Nếu không phải owner hoặc admin
        if (!isOwnerOrAdmin) {
          // Kiểm tra thời hạn giới hạn
          if (!chat.restrictUntil || new Date() < new Date(chat.restrictUntil)) {
            restrictedByGroupSettings = true
            restrictUntil = chat.restrictUntil
          } else {
            // Đã hết thời hạn, tự động tắt chế độ
            await ChatModel.findByIdAndUpdate(chatId, {
              onlyAdminsCanSend: false,
              restrictUntil: null
            })
          }
        }
      }

      // 2. Kiểm tra nếu người dùng bị cấm chat (cài đặt cá nhân)
      let isMuted = false
      let mutedUntil = null

      if (member.isMuted) {
        // Kiểm tra thời hạn cấm chat
        if (!member.mutedUntil || new Date() < new Date(member.mutedUntil)) {
          isMuted = true
          mutedUntil = member.mutedUntil
        } else {
          // Đã hết thời hạn cấm chat, tự động bỏ cấm
          await ChatModel.updateOne(
            { _id: chatId, 'members.userId': userId },
            { $set: { 'members.$.isMuted': false, 'members.$.mutedUntil': null } }
          )
        }
      }

      // Trả về kết quả
      res.json(
        new AppSuccess({
          message: 'Kiểm tra quyền gửi tin nhắn thành công',
          data: {
            canSendMessages: !isMuted && !restrictedByGroupSettings,
            isMuted,
            mutedUntil,
            restrictedByGroupSettings,
            restrictUntil,
            conversationId: chatId
          }
        })
      )
    } catch (error) {
      next(error)
    }
  }
  // Phương thức xóa lịch sử chat
  async clearChatHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.context?.user?._id
      const { conversationId } = req.params

      if (!userId) {
        return next(
          new AppError({
            status: 401,
            message: 'Unauthorized'
          })
        )
      }

      // Tìm cuộc trò chuyện
      const conversation = await ChatModel.findOne({
        _id: conversationId,
        participants: userId
      })

      if (!conversation) {
        return next(
          new AppError({
            status: 404,
            message: 'Conversation not found'
          })
        )
      }

      // Xóa bản ghi cũ nếu có
      await ChatModel.findByIdAndUpdate(conversationId, {
        $pull: { deletedMessagesFor: { userId } }
      })

      // Thêm bản ghi mới
      await ChatModel.findByIdAndUpdate(conversationId, {
        $push: {
          deletedMessagesFor: {
            userId,
            deletedAt: new Date()
          }
        }
      })

      // Tạo tin nhắn hệ thống mới
      const systemMessage = await MessageModel.create({
        chatId: conversationId,
        senderId: userId,
        content: 'Bạn đã xóa lịch sử tin nhắn',
        type: MESSAGE_TYPE.SYSTEM,
        status: MESSAGE_STATUS.DELIVERED
      })

      await ChatModel.findByIdAndUpdate(conversationId, {
        lastMessage: systemMessage._id
      })

      // Lấy thông tin đầy đủ của tin nhắn hệ thống để trả về
      const populatedSystemMessage = await MessageModel.findById(systemMessage._id)
        .populate('senderId', 'name avatar')
        .lean()

      emitSocketEvent(conversationId.toString(), SOCKET_EVENTS.LAST_MESSAGE_UPDATED, {
        conversationId,
        lastMessage: populatedSystemMessage
      })

      res.json(
        new AppSuccess({
          data: {
            conversationId,
            systemMessage: populatedSystemMessage
          },
          message: 'Lịch sử tin nhắn đã được xóa'
        })
      )
    } catch (error) {
      console.error('Error in clearChatHistory:', error)
      next(error)
    }
  }
}

const conversationsController = new ConversationsController()
export default conversationsController
