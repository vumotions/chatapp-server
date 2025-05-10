import { model, ObjectId, Schema } from 'mongoose'
import { CHAT_TYPE } from '~/constants/enums'

export interface IChat extends Document {
  userId: ObjectId
  type: CHAT_TYPE
  name?: string
  avatar?: string
  lastMessage?: ObjectId
  participants: ObjectId[]
  read: boolean
  archived: boolean
}

const chatSchema = new Schema<IChat>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    type: {
      type: String,
      enum: [CHAT_TYPE.GROUP, CHAT_TYPE.PRIVATE],
      required: true
    },
    name: {
      type: String
    },
    avatar: {
      type: String
    },
    lastMessage: {
      type: Schema.Types.ObjectId,
      ref: 'Message'
    },
    read: {
      type: Boolean,
      default: false
    },
    archived: {
      type: Boolean,
      default: false
    },
    participants: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User'
      }
    ]
  },
  { 
    timestamps: true, 
    strictQuery: false 
  }
)

const ChatModel = model<IChat>('Chat', chatSchema)

export default ChatModel
