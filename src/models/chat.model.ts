import { Document, model, Schema } from 'mongoose'
import { nanoid } from 'nanoid'
import { CHAT_TYPE, GROUP_TYPE, MEMBER_ROLE } from '~/constants/enums'

export interface IChatMember {
  userId: Schema.Types.ObjectId
  role: string
  permissions: Record<string, boolean>
  customTitle?: string
  joinedAt: Date
}

export interface IFormerMember {
  userId: Schema.Types.ObjectId
  leftAt: Date
}

export interface IChat extends Document {
  userId: Schema.Types.ObjectId
  type: CHAT_TYPE
  groupType?: GROUP_TYPE
  name?: string
  avatar?: string
  lastMessage?: Schema.Types.ObjectId
  participants: Schema.Types.ObjectId[]
  members: IChatMember[]
  read: boolean
  archived: boolean
  inviteLink?: string
  requireApproval?: boolean
  pendingRequests?: Array<{
    userId: Schema.Types.ObjectId
    requestedAt: Date
    status: string
  }>
  formerMembers?: IFormerMember[]
}

const memberPermissionsSchema = new Schema(
  {
    changeGroupInfo: { type: Boolean, default: false },
    deleteMessages: { type: Boolean, default: false },
    banUsers: { type: Boolean, default: false },
    inviteUsers: { type: Boolean, default: true },
    pinMessages: { type: Boolean, default: false },
    addNewAdmins: { type: Boolean, default: false },
    approveJoinRequests: { type: Boolean, default: false }
  },
  { _id: false }
)

const chatMemberSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: [MEMBER_ROLE.OWNER, MEMBER_ROLE.ADMIN, MEMBER_ROLE.MEMBER, MEMBER_ROLE.BOT],
      default: MEMBER_ROLE.MEMBER
    },
    permissions: {
      type: memberPermissionsSchema,
      default: () => ({})
    },
    customTitle: {
      type: String
    },
    joinedAt: {
      type: Date,
      default: Date.now
    }
  },
  { _id: false }
)

const joinRequestSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    requestedAt: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING'
    }
  },
  { _id: false }
)

// Định nghĩa schema cho formerMembers
const formerMemberSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    leftAt: {
      type: Date,
      default: Date.now
    }
  },
  { _id: false }
)

const chatSchema = new Schema<IChat>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    type: {
      type: String,
      enum: Object.values(CHAT_TYPE),
      required: true
    },
    groupType: {
      type: String,
      enum: Object.values(GROUP_TYPE),
      default: GROUP_TYPE.PUBLIC
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
    inviteLink: {
      type: String,
      default: () => nanoid(10)
    },
    requireApproval: {
      type: Boolean,
      default: false
    },
    participants: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User'
      }
    ],
    members: [chatMemberSchema],
    pendingRequests: [joinRequestSchema],
    formerMembers: [formerMemberSchema]
  },
  { 
    timestamps: true, 
    strictQuery: false 
  }
)

const ChatModel = model<IChat>('Chat', chatSchema)

export default ChatModel
