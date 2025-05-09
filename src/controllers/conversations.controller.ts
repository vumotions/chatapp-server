import { NextFunction, Request, Response } from 'express'
import status from 'http-status'
import mongoose, { ObjectId, Types } from 'mongoose'
import { Schema } from 'mongoose'
import { CHAT_TYPE, MESSAGE_STATUS, MESSAGE_TYPE } from '~/constants/enums'
import SOCKET_EVENTS from '~/constants/socket-events'
import ChatModel from '~/models/chat.model'
import { AppError } from '~/models/error.model'
import MessageModel from '~/models/message.model'
import { AppSuccess } from '~/models/success.model'
import { io, emitSocketEvent } from '~/lib/socket'

class ConversationsController {
  async getUserConversations(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.context?.user?._id
      const page = parseInt(req.query?.page as string) || 1
      const limit = parseInt(req.query?.limit as string) || 10
      const filter = req.query?.filter as string || 'all' // 'all' hoặc 'unread'
      const searchQuery = (req.query?.search as string || '').trim()
      const skip = (page - 1) * limit

      console.log('Fetching conversations for userId:', userId, 'filter:', filter, 'search:', searchQuery)

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
      const query: any = { participants: userId }
      if (filter === 'unread') {
        query.read = false
        query.lastMessage = { $exists: true } // Chỉ lấy những chat có tin nhắn
      }

      // Tìm tất cả cuộc trò chuyện mà người dùng tham gia
      let conversations = await ChatModel.find(query)
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
        .lean() // Convert to plain JavaScript objects

      // Xử lý dữ liệu trước khi lọc
      const processedConversations = conversations.map(conv => {
        const conversation = conv as any; // Type assertion to avoid TypeScript errors
        
        // Đối với chat riêng tư, lấy thông tin của người còn lại
        if (conversation.type === 'PRIVATE' && conversation.participants && conversation.participants.length > 0) {
          // Lọc ra những người tham gia khác với người dùng hiện tại
          const otherParticipants = conversation.participants.filter(
            (p: any) => p._id.toString() !== userId.toString()
          );
          
          // Lấy thông tin người đầu tiên trong danh sách
          const otherUser = otherParticipants[0];
          if (otherUser) {
            conversation.name = otherUser.name || 'Unknown User';
            conversation.avatar = otherUser.avatar || null;
          }
        }
        
        return conversation;
      });

      // Lọc kết quả theo searchQuery nếu có
      let filteredConversations = processedConversations;
      if (searchQuery) {
        filteredConversations = processedConversations.filter(conv => {
          // Tìm kiếm chính xác trong tên nhóm chat
          if (conv.name) {
            const nameMatch = conv.name.toLowerCase().includes(searchQuery.toLowerCase());
            if (nameMatch) {
              console.log(`Match found in conversation name: "${conv.name}" for query "${searchQuery}"`);
              return true;
            }
          }
          
          // Tìm kiếm chính xác trong tên người tham gia
          const participantMatch = conv.participants.some((participant: any) => {
            if (participant.name) {
              const match = participant.name.toLowerCase().includes(searchQuery.toLowerCase());
              if (match) {
                console.log(`Match found in participant name: "${participant.name}" for query "${searchQuery}"`);
              }
              return match;
            }
            return false;
          });
          
          return participantMatch;
        });
      }

      // Phân trang sau khi lọc
      const totalItems = filteredConversations.length;
      const paginatedConversations = filteredConversations.slice(skip, skip + limit);

      console.log('Search query:', searchQuery);
      console.log('Total conversations before filtering:', conversations.length);
      console.log('Total conversations after filtering:', filteredConversations.length);
      console.log('Returning conversations:', paginatedConversations.length);

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
      );
    } catch (error) {
      console.error('Error in getUserConversations:', error);
      next(error);
    }
  }

  async getMessagesByConversation(req: Request, res: Response, next: NextFunction) {
    const conversationId = req.params?.chatId;
    const userId = req.context?.user?._id;
    const page = parseInt(req.query?.page as string) || 1;
    const limit = parseInt(req.query?.limit as string) || 10;
    const skip = (page - 1) * limit;

    console.log(`Fetching messages for conversation ${conversationId}, page ${page}, limit ${limit}`);

    // Nếu không có conversationId, trả về lỗi
    if (!conversationId) {
      next(
        new AppError({
          status: status.BAD_REQUEST,
          message: 'Conversation ID is required'
        })
      );
      return;
    }

    // Kiểm tra tính hợp lệ của conversationId
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
      next(
        new AppError({
          status: status.BAD_REQUEST,
          message: 'Invalid conversation ID'
        })
      );
      return;
    }

    // Tìm conversation
    let conversation = await ChatModel.findById(conversationId)
      .populate('participants', 'name avatar')
      .populate({
        path: 'lastMessage',
        populate: {
          path: 'senderId',
          select: 'name avatar'
        }
      });

    // Lấy danh sách tin nhắn của conversation
    const messages = await MessageModel.find({ chatId: conversationId })
      .skip(skip)
      .limit(limit)
      .populate('senderId', 'name avatar')
      .sort({ createdAt: -1 });

    // Kiểm tra xem còn dữ liệu phía sau không
    const totalMessages = await MessageModel.countDocuments({ chatId: conversationId });
    const hasMore = page * limit < totalMessages;

    console.log(`Found ${messages.length} messages, total: ${totalMessages}, hasMore: ${hasMore}`);

    res.json(
      new AppSuccess({
        message: 'Get messages successfully',
        data: {
          conversation,
          messages,
          hasMore
        }
      })
    );
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
    const { chatId } = req.params
    const userId = req.context?.user?._id

    if (!chatId) {
      return next(
        new AppError({
          status: status.BAD_REQUEST,
          message: 'Chat ID is required'
        })
      )
    }

    // Cập nhật trạng thái read của chat
    const chat = await ChatModel.findOneAndUpdate(
      { _id: chatId, participants: userId },
      { read: true },
      { new: true }
    )

    if (!chat) {
      return next(
        new AppError({
          status: status.NOT_FOUND,
          message: 'Chat not found'
        })
      )
    }

    res.json(
      new AppSuccess({
        message: 'Chat marked as read',
        data: chat
      })
    )
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
        chat.lastMessage = lastMessage ? lastMessage._id as unknown as Schema.Types.ObjectId : undefined
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
      message.isEdited = true
      await message.save()
      
      console.log('Message updated successfully:', message)
      
      // Thông báo cho tất cả người dùng trong chat
      const chatId = message.chatId.toString()
      const eventData = {
        messageId: message._id.toString(),
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
      const { chatId, messageId } = req.body;
      
      if (!chatId || !messageId) {
        return next(
          new AppError({
            status: status.BAD_REQUEST,
            message: 'Chat ID and Message ID are required'
          })
        );
      }
      
      console.log(`Testing socket: emitting MESSAGE_DELETED to room ${chatId} for message ${messageId}`);
      
      // Lấy đối tượng io từ app
      const io = req.app.get('io');
      
      if (io) {
        // Gửi sự kiện đến tất cả clients
        io.emit(SOCKET_EVENTS.MESSAGE_DELETED, {
          messageId,
          chatId
        });
        
        // Gửi sự kiện đến room cụ thể
        io.to(chatId).emit(SOCKET_EVENTS.MESSAGE_DELETED, {
          messageId,
          chatId
        });
        
        console.log('Test event emitted successfully');
        
        res.json(
          new AppSuccess({
            message: 'Test event emitted successfully',
            data: { chatId, messageId }
          })
        );
      } else {
        return next(
          new AppError({
            status: status.INTERNAL_SERVER_ERROR,
            message: 'Socket.io instance not available'
          })
        );
      }
    } catch (error) {
      console.error('Error in testSocket:', error);
      next(error);
    }
  }
}

const conversationsController = new ConversationsController()
export default conversationsController
