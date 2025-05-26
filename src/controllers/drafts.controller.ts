import { NextFunction, Request, Response } from 'express'
import mongoose from 'mongoose'
import ChatModel from '~/models/chat.model'
import DraftModel from '~/models/draft.model'
import { AppError } from '~/models/error.model'
import { AppSuccess } from '~/models/success.model'

class DraftsController {
  // Lấy tất cả draft messages của user
  async getAllDrafts(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.context?.user?._id

      if (!userId) {
        return next(
          new AppError({
            status: 401, // UNAUTHORIZED
            message: 'User ID is required'
          })
        )
      }

      // Tìm tất cả draft của user
      const drafts = await DraftModel.find({ userId })
        .sort({ updatedAt: -1 })
        .populate('chatId', 'name participants type')

      // Thêm thông tin về chat cho mỗi draft
      const draftsWithChatInfo = await Promise.all(
        drafts.map(async (draft) => {
          const draftObj = draft.toObject()

          // Nếu có chatId, lấy thêm thông tin về chat
          if (draft.chatId) {
            // Kiểm tra tính hợp lệ của chatId trước khi truy vấn
            if (!mongoose.Types.ObjectId.isValid(draft.chatId)) {
              return draftObj;
            }
            
            const chat = await ChatModel.findById(draft.chatId).populate(
              'participants',
              'name avatar username'
            )

            if (chat) {
              // Thêm tên chat nếu có
              (draftObj as any).chatName =
                chat.name ||
                chat.participants
                  .filter((p: any) => p._id.toString() !== userId.toString())
                  .map((p: any) => p.name)
                  .join(', ')
            }
          }

          return draftObj
        })
      )

      res.json(
        new AppSuccess({
          message: 'Get all drafts successfully',
          data: draftsWithChatInfo
        })
      )
    } catch (error) {
      next(error)
    }
  }

  // Lấy draft message theo chatId
  async getDraftByChatId(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.context?.user?._id as string
      const { chatId } = req.params

      if (!userId) {
        next(
          new AppError({
            status: 401, // UNAUTHORIZED
            message: 'User ID is required'
          })
        )
        return
      }

      // Kiểm tra tính hợp lệ của chatId
      if (!chatId || !mongoose.Types.ObjectId.isValid(chatId)) {
        next(
          new AppError({
            status: 400, // BAD_REQUEST
            message: 'Invalid conversation ID'
          })
        )
        return
      }

      // Tìm draft theo chatId và userId
      const draft = await DraftModel.findOne({ chatId, userId }).populate(
        'chatId',
        'name participants type'
      )

      if (!draft) {
        res.json(
          new AppSuccess({
            message: 'No draft found',
            data: null
          })
        )
        return
      }

      res.json(
        new AppSuccess({
          message: 'Get draft successfully',
          data: draft
        })
      )
    } catch (error) {
      next(error)
    }
  }

  // Lưu draft message
  async saveDraft(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.context?.user?._id
      const { chatId, content, attachments } = req.body

      if (!userId) {
        next(
          new AppError({
            status: 401, // UNAUTHORIZED
            message: 'User ID is required'
          })
        )
        return
      }

      // Kiểm tra tính hợp lệ của chatId
      if (!chatId || !mongoose.Types.ObjectId.isValid(chatId)) {
        next(
          new AppError({
            status: 400, // BAD_REQUEST
            message: 'Invalid conversation ID'
          })
        )
        return
      }

      // Kiểm tra xem chat có tồn tại không
      const chat = await ChatModel.findById(chatId)
      if (!chat) {
        next(
          new AppError({
            status: 404, // NOT_FOUND
            message: 'Conversation not found'
          })
        )
        return
      }

      // Kiểm tra xem user có trong cuộc trò chuyện không
      if (!chat.participants.some(participantId => participantId.toString() === userId.toString())) {
        next(
          new AppError({
            status: 403, // FORBIDDEN
            message: 'You are not a participant of this conversation'
          })
        )
        return
      }

      // Tìm draft hiện có hoặc tạo mới
      let draft = await DraftModel.findOne({ chatId, userId })

      if (draft) {
        // Cập nhật draft hiện có
        draft.content = content
        draft.attachments = attachments
        await draft.save()
      } else {
        // Tạo draft mới
        draft = await DraftModel.create({
          userId,
          chatId,
          content,
          attachments
        })
      }

      res.json(
        new AppSuccess({
          message: 'Draft saved successfully',
          data: draft
        })
      )
    } catch (error) {
      next(error)
    }
  }

  // Xóa draft message
  async deleteDraft(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.context?.user?._id
      const { draftId } = req.params

      if (!userId) {
        return next(
          new AppError({
            status: 401, // UNAUTHORIZED
            message: 'User ID is required'
          })
        )
      }

      // Kiểm tra tính hợp lệ của draftId
      if (!draftId || !mongoose.Types.ObjectId.isValid(draftId)) {
        return next(
          new AppError({
            status: 400, // BAD_REQUEST
            message: 'Invalid draft ID'
          })
        )
      }

      // Tìm và xóa draft
      const draft = await DraftModel.findOneAndDelete({ _id: draftId, userId })

      if (!draft) {
        return next(
          new AppError({
            status: 404, // NOT_FOUND
            message: 'Draft not found'
          })
        )
      }

      res.json(
        new AppSuccess({
          message: 'Draft deleted successfully',
          data: draft
        })
      )
    } catch (error) {
      next(error)
    }
  }
}

export default new DraftsController()





