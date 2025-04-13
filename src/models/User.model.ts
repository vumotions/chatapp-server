import { model, Schema, Types } from 'mongoose'

const viewConfigSchema = new Schema(
  {
    whoCanSee: {
      type: String,
      enum: ['everyone', 'contacts', 'nobody'],
      default: 'everyone'
    },
    whoCanFind: {
      type: String,
      enum: ['everyone', 'contacts', 'nobody'],
      default: 'everyone'
    }
  },
  { _id: false }
)

const privacySettingsSchema = new Schema(
  {
    phoneNumber: {
      whoCanSee: { type: String, enum: ['everyone', 'contacts', 'nobody'], default: 'everyone' },
      whoCanFind: { type: String, enum: ['everyone', 'contacts', 'nobody'], default: 'everyone' }
    },
    lastSeenOnline: viewConfigSchema,
    profilePicture: viewConfigSchema,
    bio: viewConfigSchema,
    dateOfBirth: viewConfigSchema
  },
  { _id: false }
)

const securitySettingsSchema = new Schema(
  {
    blockedUsers: [{ type: Types.ObjectId, ref: 'User' }],
    activeSessions: [{ type: String }]
  },
  { _id: false }
)

const userSchema = new Schema(
  {
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    profilePicture: { type: String },
    name: { type: String },
    bio: { type: String },
    phoneNumber: { type: String },
    dateOfBirth: { type: Date },
    isBot: { type: Boolean, default: false },
    apiKey: { type: String },
    createdBy: { type: Types.ObjectId, ref: 'User' },
    privacySettings: privacySettingsSchema,
    securitySettings: securitySettingsSchema
  },
  { timestamps: true }
)

const UserModel = model('User', userSchema)

export default UserModel
