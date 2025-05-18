import { Document, model, Schema } from 'mongoose'
import { CALL_STATUS, CALL_TYPE } from '~/constants/enums'

export interface ICallParticipant {
  userId: Schema.Types.ObjectId
  joinedAt: Date
  leftAt?: Date
  isMuted: boolean
  isCameraOff: boolean
}

export interface ICall extends Document {
  chatId: Schema.Types.ObjectId
  initiatorId: Schema.Types.ObjectId
  type: CALL_TYPE
  status: CALL_STATUS
  startedAt: Date
  endedAt?: Date
  duration?: number
  participants: ICallParticipant[]
}

const callParticipantSchema = new Schema<ICallParticipant>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    leftAt: {
      type: Date
    },
    isMuted: {
      type: Boolean,
      default: false
    },
    isCameraOff: {
      type: Boolean,
      default: false
    }
  },
  { _id: false }
)

const callSchema = new Schema<ICall>(
  {
    chatId: {
      type: Schema.Types.ObjectId,
      ref: 'Chat',
      required: true
    },
    initiatorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    type: {
      type: String,
      enum: Object.values(CALL_TYPE),
      required: true
    },
    status: {
      type: String,
      enum: Object.values(CALL_STATUS),
      default: CALL_STATUS.RINGING
    },
    startedAt: {
      type: Date,
      default: Date.now
    },
    endedAt: {
      type: Date
    },
    duration: {
      type: Number
    },
    participants: [callParticipantSchema]
  },
  { timestamps: true }
)

const CallModel = model<ICall>('Call', callSchema)

export default CallModel