import { NextFunction, Request, Response } from 'express'
import { AppError } from '~/models/error.model'
import { AppSuccess } from '~/models/success.model'
import { IUser } from '~/models/user.model'
import notificationService from '~/services/notification.service'
import NotificationModel from '~/models/notification.model'

class NotificationController {
  async getUserNotifications(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.context?.user as IUser)._id as string
      const page = parseInt(req.query.page as string) || 1
      const limit = parseInt(req.query.limit as string) || 10
      const filter = req.query.filter as string || 'all' // 'all' hoặc 'unread'
      
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
        throw new AppError({ message: 'Thông báo không tồn tại hoặc không thuộc về bạn', status: 404 })
      }

      // Update notification
      notification.read = true
      await notification.save()

      return res.json(new AppSuccess({ data: notification, message: 'Đã đánh dấu đã đọc' }))
    } catch (error) {
      console.error('Error marking notification as read:', error)
      next(error)
    }
  }

  async markAllAsRead(req: Request, res: Response, next: NextFunction) {
    const userId = (req.context?.user as IUser)._id as string
    await notificationService.markAllAsRead(userId)
    res.json(new AppSuccess({ data: null, message: 'Đã đánh dấu tất cả đã đọc' }))
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
