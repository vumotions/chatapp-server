import { ObjectId } from 'mongodb'
import { Document, Schema, model } from 'mongoose'
import { USER_VERIFY_STATUS } from '~/constants/enums'
import { generateUsername } from '~/helpers/common'

export interface IUser extends Document {
  name?: string
  username: string
  email: string
  passwordHash?: string
  avatar?: string
  coverPhoto?: string
  bio?: string
  dateOfBirth?: Date
  verify: USER_VERIFY_STATUS
  provider?: string
  providerId?: string
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
      unique: true,
      default: function () {
        if (!this.username) {
          return generateUsername(this.name || this.email)
        }
      }
    },
    email: {
      type: String,
      required: true
    },
    passwordHash: {
      type: String,
      default: ''
    },
    avatar: {
      type: String,
      default: ''
    },
    coverPhoto: {
      type: String,
      default: ''
    },
    name: {
      type: String
    },
    bio: {
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
    provider: {
      type: String,
      default: ''
    },
    providerId: {
      type: String,
      default: ''
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
      required: function () {
        return this.isBot
      },
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
