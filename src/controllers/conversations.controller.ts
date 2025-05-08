import { NextFunction, Request, Response } from 'express'
import status from 'http-status'
import mongoose, { ObjectId } from 'mongoose'
import { CHAT_TYPE, MESSAGE_STATUS, MESSAGE_TYPE } from '~/constants/enums'
import ChatModel from '~/models/chat.model'
import { AppError } from '~/models/error.model'
import MessageModel from '~/models/message.model'
import { AppSuccess } from '~/models/success.model'

class ConversationsController {
  async getUserConversations(req: Request, res: Response, next: NextFunction) {
    const userId = req.context?.user?._id
    const page = parseInt(req.query?.page as string) || 1
    const limit = parseInt(req.query?.limit as string) || 10
    const skip = (page - 1) * limit

    console.log('Fetching conversations for userId:', userId)

    // Tìm tất cả cuộc trò chuyện mà người dùng tham gia
    const conversations = await ChatModel.find({ 
      participants: userId 
    })
      .skip(skip)
      .limit(limit)
      .populate({
        path: 'participants',
        select: 'name avatar',
        match: { _id: { $ne: userId } } // Chỉ populate những người khác, không phải người dùng hiện tại
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

    console.log('Found conversations:', conversations.length)

    // Xử lý dữ liệu trước khi trả về
    const processedConversations = conversations.map(conv => {
      const conversation = conv as any; // Type assertion to avoid TypeScript errors
      
      // Đối với chat riêng tư, lấy thông tin của người còn lại
      if (conversation.type === 'PRIVATE' && conversation.participants && conversation.participants.length > 0) {
        // Lấy thông tin người đầu tiên trong danh sách (đã lọc bỏ người dùng hiện tại)
        const otherUser = conversation.participants[0];
        if (otherUser) {
          conversation.name = otherUser.name || 'Unknown User';
          conversation.avatar = otherUser.avatar || null;
        }
      }
      
      return conversation;
    });

    // Kiểm tra xem còn dữ liệu phía sau không
    const totalCount = await ChatModel.countDocuments({ participants: userId })
    const hasMore = page * limit < totalCount

    res.json(
      new AppSuccess({
        message: 'Get messages successfully',
        data: {
          conversations: processedConversations,
          hasMore
        }
      })
    )
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
}

const conversationsController = new ConversationsController()
export default conversationsController
