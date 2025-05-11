import mongoose, { Types, UpdateWriteOpResult } from 'mongoose'
import NotificationModel, { INotification } from '~/models/notification.model'
export interface CreateNotificationInput {
  userId: Types.ObjectId | string
  senderId: Types.ObjectId | string
  type: string
  relatedId: Types.ObjectId | string
}

class NotificationService {
  async createNotification(input: CreateNotificationInput): Promise<INotification> {
    return NotificationModel.create(input)
  }

  async getUserNotifications(
    userId: Types.ObjectId | string,
    options: { page?: number; limit?: number; filter?: string; excludeTypes?: string[] } = {}
  ): Promise<any> {
    const { page = 1, limit = 10, filter = 'all', excludeTypes = [] } = options
    const skip = (page - 1) * limit
    
    // Xây dựng query dựa trên filter
    const query: any = { userId }
    if (filter === 'unread') {
      query.read = false
    }
    
    // Loại trừ các loại thông báo nếu cần
    if (excludeTypes.length > 0) {
      query.type = { $nin: excludeTypes }
    }
    
    // Lấy tổng số thông báo theo filter
    const total = await NotificationModel.countDocuments(query)
    
    // Lấy danh sách thông báo với phân trang và filter
    const notifications = await NotificationModel.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('senderId', 'name avatar')
      .populate('relatedId') // Populate relatedId để lấy thông tin về lời mời kết bạn
    
    // Kiểm tra xem còn dữ liệu phía sau không
    const hasMore = page * limit < total
    
    return {
      notifications,
      hasMore
    }
  }

  async markAsRead(notificationId: Types.ObjectId | string): Promise<INotification | null> {
    return NotificationModel.findByIdAndUpdate(notificationId, { read: true }, { new: true })
  }

  async markAllAsRead(userId: Types.ObjectId | string): Promise<UpdateWriteOpResult> {
    return NotificationModel.updateMany({ userId, read: false }, { read: true })
  }

  async deleteNotificationByRelatedId(relatedId: string | mongoose.Types.ObjectId) {
    try {
      await NotificationModel.deleteMany({ relatedId })
      return true
    } catch (error) {
      console.error('Error deleting notifications:', error)
      return false
    }
  }

  async deleteNotification(notificationId: Types.ObjectId | string): Promise<boolean> {
    try {
      const result = await NotificationModel.findByIdAndDelete(notificationId)
      return !!result
    } catch (error) {
      console.error('Error deleting notification:', error)
      return false
    }
  }

  async deleteAllNotifications(userId: Types.ObjectId | string): Promise<boolean> {
    try {
      const result = await NotificationModel.deleteMany({ userId })
      return result.deletedCount > 0
    } catch (error) {
      console.error('Error deleting all notifications:', error)
      return false
    }
  }
}

const notificationService = new NotificationService()
export default notificationService
