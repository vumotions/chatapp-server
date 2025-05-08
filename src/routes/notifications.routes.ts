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
notificationRoutes.post(
  '/read',
  accessTokenValidator,
  verifiedUserValidator,
  notificationController.markAsRead
)

// Đánh dấu tất cả thông báo đã đọc
notificationRoutes.post(
  '/read-all',
  accessTokenValidator,
  verifiedUserValidator,
  notificationController.markAllAsRead
)

export default notificationRoutes
