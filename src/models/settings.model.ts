import { Schema, model, Document, ObjectId } from 'mongoose'
import { ACCESS_SCOPE } from '~/constants/enums'

interface IViewConfig {
  whoCanSee: string
  whoCanFind: string
}

export interface ISettings extends Document {
  userId: ObjectId
  privacy: {
    phoneNumber: IViewConfig
    lastSeenOnline: IViewConfig
    profilePicture: IViewConfig
    bio: IViewConfig
    dateOfBirth: IViewConfig
  }
  security: {
    blockedUsers: ObjectId[]
    activeSessions: string[]
  }
  preferences: {
    language: string
    theme: string
  }
}

const VISIBILITY = [ACCESS_SCOPE.CONTACTS, ACCESS_SCOPE.EVERYONE, ACCESS_SCOPE.NOBODY] as const
const defaultViewConfig = { whoCanSee: ACCESS_SCOPE.EVERYONE, whoCanFind: ACCESS_SCOPE.EVERYONE }

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

const settingsSchema = new Schema<ISettings>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    privacy: {
      type: {
        phoneNumber: viewConfigSchema,
        lastSeenOnline: viewConfigSchema,
        profilePicture: viewConfigSchema,
        bio: viewConfigSchema,
        dateOfBirth: viewConfigSchema
      },
      default: {
        phoneNumber: defaultViewConfig,
        lastSeenOnline: defaultViewConfig,
        profilePicture: defaultViewConfig,
        bio: defaultViewConfig,
        dateOfBirth: defaultViewConfig
      }
    },
    security: {
      type: {
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
      default: {
        blockedUsers: [],
        activeSessions: []
      }
    },
    preferences: {
      type: {
        language: {
          type: String,
          enum: ['en', 'vi', 'ru', 'zh'],
          default: 'en'
        },
        theme: {
          type: String,
          enum: ['light', 'dark', 'system'],
          default: 'system'
        }
      },
      default: {
        language: 'en',
        theme: 'system'
      }
    }
  },
  { timestamps: true }
)

const SettingsModel = model<ISettings>('Settings', settingsSchema)

export default SettingsModel
