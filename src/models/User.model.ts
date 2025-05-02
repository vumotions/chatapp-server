import { ObjectId } from 'mongodb'
import { Document, Schema, model } from 'mongoose'
import { USER_VERIFY_STATUS } from '~/constants/enums'

export interface IUser extends Document {
  username: string
  email: string
  passwordHash: string
  profilePicture?: string
  name?: string
  bio?: string
  phoneNumber?: string
  dateOfBirth?: Date
  verify: string
  isBot: boolean
  apiKey?: string
  createdBy: ObjectId | null
  emailLockedUntil: Date | null
}

const VERIFICATION_STATUS = [USER_VERIFY_STATUS.VERIFIED, USER_VERIFY_STATUS.UNVERIFIED] as const

const userSchema = new Schema<IUser>(
  {
    username: {
      type: String,
      unique: true
    },
    email: {
      type: String,
      required: true
    },
    passwordHash: {
      type: String,
      required: true
    },
    profilePicture: {
      type: String
    },
    name: {
      type: String
    },
    bio: {
      type: String
    },
    phoneNumber: {
      type: String
    },
    dateOfBirth: {
      type: Date
    },
    verify: {
      type: String,
      enum: VERIFICATION_STATUS,
      default: USER_VERIFY_STATUS.UNVERIFIED
    },
    isBot: {
      type: Boolean,
      default: false
    },
    apiKey: {
      type: String
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    emailLockedUntil: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
)

const UserModel = model<IUser>('User', userSchema)

export default UserModel
