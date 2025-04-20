import { Schema, model, Document } from 'mongoose'
import { ObjectId } from 'mongodb'

export interface IOTP extends Document {
  code: string
  userId: ObjectId
  purpose: string
  expiresAt: Date
  createdAt: Date
  isUsed: boolean
}

const otpSchema = new Schema<IOTP>({
  code: {
    type: String,
    required: true
  },
  userId: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'User'
  },
  purpose: {
    type: String,
    enum: ['EMAIL_VERIFICATION', 'PASSWORD_RESET'],
    required: true
  },
  expiresAt: {
    type: Date,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  isUsed: {
    type: Boolean,
    default: false
  }
})

const OTPModel = model<IOTP>('OTP', otpSchema)

export default OTPModel
