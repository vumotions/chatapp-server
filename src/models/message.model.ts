import { Document, model, ObjectId, Schema } from 'mongoose'
import { MEDIA_TYPE, MESSAGE_STATUS, MESSAGE_TYPE } from '~/constants/enums'

interface Attachment {
  mediaUrl: string
  type: MEDIA_TYPE
}

interface Reaction {
  userId: ObjectId
  type: string
  createdAt: Date
}

export interface IMessage extends Document {
  chatId: ObjectId
  senderId: ObjectId
  content?: string
  attachments?: Attachment[]
  type: MESSAGE_TYPE
  status: MESSAGE_STATUS
  readBy: string[]
  isPinned?: boolean
  isEdited?: boolean
  reactions?: Reaction[]
}

const messageSchema = new Schema<IMessage>(
  {
    chatId: {
      type: Schema.Types.ObjectId,
      ref: 'Chat',
      required: true
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    content: {
      type: String,
      required: function (this: IMessage) {
        return this.type === MESSAGE_TYPE.TEXT
      }
    },
    readBy: {
      type: [String],
      default: []
    },
    attachments: [
      {
        mediaUrl: {
          type: String,
          required: function (this: { $parent: IMessage }) {
            return this.$parent.type === MESSAGE_TYPE.MEDIA
          }
        },
        type: {
          type: String,
          enum: Object.values(MEDIA_TYPE),
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
    isPinned: {
      type: Boolean,
      default: false
    },
    isEdited: {
      type: Boolean,
      default: false
    },
    reactions: [
      {
        userId: {
          type: Schema.Types.ObjectId,
          ref: 'User',
          required: true
        },
        type: {
          type: String,
          default: '❤️'
        },
        createdAt: {
          type: Date,
          default: Date.now
        }
      }
    ]
  },
  { timestamps: true }
)

const MessageModel = model<IMessage>('Message', messageSchema)

export default MessageModel
