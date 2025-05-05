import { Document, model, ObjectId, Schema } from 'mongoose'
import { MEDIA_TYPE, MESSAGE_STATUS, MESSAGE_TYPE } from '~/constants/enums'

interface Attachment {
  mediaUrl: string
  type: MEDIA_TYPE
}

export interface IMessage extends Document {
  chat_id: ObjectId
  sender_id: ObjectId
  content?: string
  attachments?: Attachment[]
  type: MESSAGE_TYPE
  status: MESSAGE_STATUS
  readBy: string[]
  is_pinned?: boolean
}

const messageSchema = new Schema<IMessage>(
  {
    chat_id: {
      type: Schema.Types.ObjectId,
      ref: 'Chat',
      required: true
    },
    sender_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    content: {
      type: String,
      required: function () {
        return this.type === MESSAGE_TYPE.TEXT
      }
    },
    readBy: {
      type: [String],
      default: []
    },
    attachments: [
      {
        media_url: {
          type: String,
          required: function () {
            return [MEDIA_TYPE.FILE, MEDIA_TYPE.VIDEO, MEDIA_TYPE.IMAGE].includes(this.type)
          }
        },
        type: {
          type: String,
          enum: [MEDIA_TYPE.FILE, MEDIA_TYPE.VIDEO, MEDIA_TYPE.IMAGE],
          required: true
        }
      }
    ],
    type: {
      type: String,
      enum: [MESSAGE_TYPE.MEDIA, MESSAGE_TYPE.TEXT, MESSAGE_TYPE.SYSTEM],
      required: true
    },
    status: {
      type: String,
      enum: [MESSAGE_STATUS.SENT, MESSAGE_STATUS.DELIVERED, MESSAGE_STATUS.SEEN],
      default: MESSAGE_STATUS.SENT
    },
    is_pinned: {
      type: Boolean,
      default: false
    }
  },
  { timestamps: true }
)

const MessageModel = model<IMessage>('Message', messageSchema)

export default MessageModel
