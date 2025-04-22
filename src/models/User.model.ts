import { Schema, model, Document, Types } from 'mongoose'
import { ObjectId } from 'mongodb'
import { ACCESS_SCOPE, USER_VERIFY_STATUS } from '~/constants/enums'

interface IViewConfig extends Document {
  whoCanSee: string
  whoCanFind: string
}

interface IPrivacySettings extends Document {
  phoneNumber: IViewConfig
  lastSeenOnline: IViewConfig
  profilePicture: IViewConfig
  bio: IViewConfig
  dateOfBirth: IViewConfig
}

interface ISecuritySettings extends Document {
  blockedUsers: ObjectId[]
  activeSessions: string[]
}

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
  privacySettings: IPrivacySettings
  securitySettings: ISecuritySettings
  emailLockedUntil: Date | null
}

const VISIBILITY = [ACCESS_SCOPE.CONTACTS, ACCESS_SCOPE.EVERYONE, ACCESS_SCOPE.NOBODY] as const
const VERIFICATION_STATUS = [USER_VERIFY_STATUS.VERIFIED, USER_VERIFY_STATUS.UNVERIFIED] as const

const viewConfigSchema = new Schema<IViewConfig>(
  {
    whoCanSee: {
      type: String,
      enum: VISIBILITY,
      default: ACCESS_SCOPE.EVERYONE
    },
    whoCanFind: {
      type: String,
      enum: VISIBILITY,
      default: ACCESS_SCOPE.EVERYONE
    }
  },
  { _id: false }
)

const privacySettingsSchema = new Schema<IPrivacySettings>(
  {
    phoneNumber: viewConfigSchema,
    lastSeenOnline: viewConfigSchema,
    profilePicture: viewConfigSchema,
    bio: viewConfigSchema,
    dateOfBirth: viewConfigSchema
  },
  { _id: false }
)

const securitySettingsSchema = new Schema<ISecuritySettings>(
  {
    blockedUsers: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User'
      }
    ],
    activeSessions: [
      {
        type: String
      }
    ]
  },
  { _id: false }
)

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
    privacySettings: {
      type: privacySettingsSchema,
      default: {
        phoneNumber: { whoCanSee: ACCESS_SCOPE.EVERYONE, whoCanFind: ACCESS_SCOPE.EVERYONE },
        lastSeenOnline: { whoCanSee: ACCESS_SCOPE.EVERYONE, whoCanFind: ACCESS_SCOPE.EVERYONE },
        profilePicture: { whoCanSee: ACCESS_SCOPE.EVERYONE, whoCanFind: ACCESS_SCOPE.EVERYONE },
        bio: { whoCanSee: ACCESS_SCOPE.EVERYONE, whoCanFind: ACCESS_SCOPE.EVERYONE },
        dateOfBirth: { whoCanSee: ACCESS_SCOPE.EVERYONE, whoCanFind: ACCESS_SCOPE.EVERYONE }
      } as any
    },
    securitySettings: {
      type: securitySettingsSchema,
      default: {
        blockedUsers: [],
        activeSessions: []
      }
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
