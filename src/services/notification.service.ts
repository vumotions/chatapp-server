import { Types, UpdateWriteOpResult } from 'mongoose'
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

  async getUserNotifications(userId: Types.ObjectId | string): Promise<any[]> {
    return NotificationModel.find({ userId })
      .sort({ createdAt: -1 })
      .populate('senderId', 'name avatar')
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
}

const notificationService = new NotificationService()
export default notificationService
