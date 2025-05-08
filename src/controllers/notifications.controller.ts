import { Request, Response, NextFunction } from 'express'
import notificationService from '~/services/notification.service'
import { AppSuccess } from '~/models/success.model'
import { AppError } from '~/models/error.model'
import { IUser } from '~/models/user.model'

class NotificationController {
  async getUserNotifications(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.context?.user as IUser)._id as string
      const notifications = await notificationService.getUserNotifications(userId)
      res.json(
        new AppSuccess({ data: notifications, message: 'Lấy danh sách thông báo thành công' })
      )
    } catch (err) {
      next(err)
    }
  }

  async markAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const { notificationId } = req.body
      if (!notificationId) throw new AppError({ message: 'Thiếu notificationId', status: 400 })
      const notification = await notificationService.markAsRead(notificationId)
      res.json(new AppSuccess({ data: notification, message: 'Đã đánh dấu đã đọc' }))
    } catch (err) {
      next(err)
    }
  }

  async markAllAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.context?.user as IUser)._id as string
      await notificationService.markAllAsRead(userId)
      res.json(new AppSuccess({ data: null, message: 'Đã đánh dấu tất cả đã đọc' }))
    } catch (err) {
      next(err)
    }
  }
}

const notificationController = new NotificationController()
export default notificationController
