import { Router } from 'express'
import { accessTokenValidator, verifiedUserValidator } from '~/middlewares/auth.middleware'
import notificationController from '../controllers/notification.controller'

const notificationRoutes = Router()

// Lấy danh sách thông báo của user
notificationRoutes.get(
  '/',
  accessTokenValidator,
  verifiedUserValidator,
  notificationController.getUserNotifications
)

// Đánh dấu một thông báo đã đọc
notificationRoutes.patch(
  '/:notificationId/read',
  accessTokenValidator,
  verifiedUserValidator,
  notificationController.markAsRead
)

// Đánh dấu tất cả thông báo đã đọc
notificationRoutes.patch(
  '/read-all',
  accessTokenValidator,
  verifiedUserValidator,
  notificationController.markAllAsRead
)

// Xóa một thông báo
notificationRoutes.delete(
  '/:notificationId',
  accessTokenValidator,
  verifiedUserValidator,
  notificationController.deleteNotification
)

// Xóa tất cả thông báo
notificationRoutes.delete(
  '/',
  accessTokenValidator,
  verifiedUserValidator,
  notificationController.deleteAllNotifications
)

export default notificationRoutes
