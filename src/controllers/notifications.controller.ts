import { Request, Response, NextFunction } from 'express'
import notificationService from '~/services/notification.service'
import { AppSuccess } from '~/models/success.model'
import { AppError } from '~/models/error.model'
import { IUser } from '~/models/User.model'
import NotificationModel from '~/models/notification.model'
import { NOTIFICATION_TYPE } from '~/constants/enums'

class NotificationController {
  async getNotifications(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.context?.user?._id
      const { page = 1, limit = 10, filter = 'all', excludeTypes } = req.query

      // Parse pagination parameters
      const pageNumber = parseInt(page as string)
      const limitNumber = parseInt(limit as string)
      const skip = (pageNumber - 1) * limitNumber

      // Xây dựng query
      const query: any = {
        userId,
        deleted: { $ne: true } // Chỉ lấy những thông báo chưa bị xóa
      }

      // Xử lý filter
      if (filter === 'unread') {
        query.read = false
      }

      // Xử lý excludeTypes
      if (excludeTypes) {
        const typesToExclude = (excludeTypes as string).split(',')
        query.type = { $nin: typesToExclude }
      }

      // Đếm tổng số thông báo
      const total = await NotificationModel.countDocuments(query)

      // Thực hiện query với pagination
      const notifications = await NotificationModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNumber)
        .populate('senderId', 'name avatar')

      // Tính toán thông tin phân trang
      const totalPages = Math.ceil(total / limitNumber)
      const hasMore = pageNumber < totalPages

      // Cấu trúc kết quả theo đúng format mà client đang sử dụng
      const result = {
        notifications,
        hasMore,
        totalPages,
        currentPage: pageNumber
      }

      res.json(
        new AppSuccess({
          message: 'Lấy danh sách thông báo thành công',
          data: result
        })
      )
    } catch (error) {
      next(error)
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

  async deleteNotification(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.context?.user?._id
      const { notificationId } = req.params

      // Tìm thông báo
      const notification = await NotificationModel.findOne({
        _id: notificationId,
        userId
      })

      if (!notification) {
        throw new AppError({
          message: 'Không tìm thấy thông báo',
          status: 404
        })
      }

      // Thay vì xóa hoàn toàn, đánh dấu là đã xóa
      notification.deleted = true
      await notification.save()

      res.json(
        new AppSuccess({
          message: 'Đã xóa thông báo',
          data: { notificationId }
        })
      )
    } catch (error) {
      next(error)
    }
  }
}

const notificationController = new NotificationController()
export default notificationController
