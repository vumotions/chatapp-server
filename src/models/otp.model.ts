import { Schema, model, Document } from 'mongoose'
import { ObjectId } from 'mongodb'
import { OTP_PURPOSE } from '~/constants/enums'

export interface IOTP extends Document {
  code: string
  email: string
  purpose: string
  verify: boolean
  expiresAt: Date
  createdAt: Date
}

const otpSchema = new Schema<IOTP>({
  code: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    ref: 'User'
  },
  purpose: {
    type: String,
    enum: [
      OTP_PURPOSE.EMAIL_VERIFICATION,
      OTP_PURPOSE.PASSWORD_RESET,
      OTP_PURPOSE.FORGOT_PASSWORD,
      OTP_PURPOSE.NEW_DEVICE_LOGIN,
      OTP_PURPOSE.TWO_FACTOR_AUTHENTICATION
    ],
    required: true
  },
  verify: {
    type: Boolean,
    required: true,
    default: false
  },
  expiresAt: {
    type: Date,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
})

const OTPModel = model<IOTP>('OTP', otpSchema)

export default OTPModel
