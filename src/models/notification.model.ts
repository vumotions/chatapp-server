import { model, ObjectId, Schema } from 'mongoose'
import { NOTIFICATION_TYPE } from '~/constants/enums'

export interface INotification extends Document {
  userId: ObjectId
  senderId: ObjectId
  type: NOTIFICATION_TYPE
  relatedId: ObjectId
  read: boolean
  processed: boolean
  deleted?: boolean
  metadata?: {
    chatId?: string
    chatName?: string
    isGroup?: boolean
    [key: string]: any
  }
}

const notificationSchema = new Schema<INotification>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    type: {
      type: String,
      required: true
    },
    relatedId: {
      type: Schema.Types.ObjectId,
      required: true
    },
    read: {
      type: Boolean,
      default: false
    },
    processed: {
      type: Boolean,
      default: false
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {}
    },
    deleted: {
      type: Boolean,
      default: false
    }
  },
  { timestamps: true }
)

const NotificationModel = model<INotification>('Notification', notificationSchema)

export default NotificationModel
