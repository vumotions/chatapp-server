import { NextFunction, Request, Response } from 'express'
import { NOTIFICATION_TYPE } from '~/constants/enums'
import SOCKET_EVENTS from '~/constants/socket-events'
import { emitSocketEvent, users } from '~/lib/socket'
import NotificationModel from '~/models/notification.model'
import { AppError } from '~/models/error.model'
import { AppSuccess } from '~/models/success.model'
import { IUser } from '~/models/User.model'
import notificationService from '~/services/notification.service'

class NotificationController {
  async getUserNotifications(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.context?.user as IUser)._id as string
      const page = parseInt(req.query.page as string) || 1
      const limit = parseInt(req.query.limit as string) || 10
      const filter = (req.query.filter as string) || 'all' // 'all' hoặc 'unread'

      const result = await notificationService.getUserNotifications(userId, {
        page,
        limit,
        filter
      })

      res.json(new AppSuccess({ data: result, message: 'Lấy danh sách thông báo thành công' }))
    } catch (err) {
      next(err)
    }
  }

  async markAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const { notificationId } = req.params
      const userId = (req.context?.user as IUser)._id as string

      // Validate notification exists and belongs to user
      const notification = await NotificationModel.findOne({
        _id: notificationId,
        userId
      })

      if (!notification) {
        throw new AppError({
          message: 'Thông báo không tồn tại hoặc không thuộc về bạn',
          status: 404
        })
      }

      // Update notification
      notification.read = true
      await notification.save()

      // Populate sender information for the response
      const populatedNotification = await NotificationModel.findById(notificationId)
        .populate('senderId', 'name avatar')
        .lean()

      // Emit socket event for real-time update - sử dụng emitSocketEvent
      emitSocketEvent(userId.toString(), SOCKET_EVENTS.NOTIFICATION_NEW, {
        ...populatedNotification,
        isUpdate: true // Thêm flag để client biết đây là cập nhật
      })

      res.json(new AppSuccess({ data: populatedNotification, message: 'Đã đánh dấu đã đọc' }))
    } catch (error) {
      console.error('Error marking notification as read:', error)
      next(error)
    }
  }

  async markAllAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.context?.user as IUser)._id as string

      // Update all unread notifications
      await NotificationModel.updateMany({ userId, read: false }, { $set: { read: true } })

      // Emit socket event for real-time update - sử dụng emitSocketEvent
      emitSocketEvent(userId.toString(), SOCKET_EVENTS.NOTIFICATION_NEW, {
        allRead: true,
        userId,
        isUpdate: true
      })

      res.json(new AppSuccess({ data: null, message: 'Đã đánh dấu tất cả đã đọc' }))
    } catch (err) {
      next(err)
    }
  }

  async deleteNotification(req: Request, res: Response, next: NextFunction) {
    try {
      const { notificationId } = req.params
      if (!notificationId) throw new AppError({ message: 'Thiếu notificationId', status: 400 })

      const result = await notificationService.deleteNotification(notificationId)

      if (result) {
        res.json(new AppSuccess({ data: null, message: 'Đã xóa thông báo' }))
      } else {
        throw new AppError({ message: 'Không thể xóa thông báo', status: 400 })
      }
    } catch (err) {
      next(err)
    }
  }

  async deleteAllNotifications(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.context?.user as IUser)._id as string
      const result = await notificationService.deleteAllNotifications(userId)

      if (result) {
        res.json(new AppSuccess({ data: null, message: 'Đã xóa tất cả thông báo' }))
      } else {
        throw new AppError({ message: 'Không thể xóa thông báo', status: 400 })
      }
    } catch (err) {
      next(err)
    }
  }
}

const notificationController = new NotificationController()
export default notificationController
