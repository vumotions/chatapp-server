import { Schema, model, Document } from 'mongoose'
import { ObjectId } from 'mongodb'

export interface IRefreshToken extends Document {
  token: string
  createdAt: Date
  userId: ObjectId
}

const refreshTokenSchema = new Schema<IRefreshToken>({
  token: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  userId: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'User'
  }
})

const RefreshTokenModel = model<IRefreshToken>('RefreshToken', refreshTokenSchema)

export default RefreshTokenModel
