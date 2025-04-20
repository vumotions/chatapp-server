import { Schema, model, Document } from 'mongoose'
import { ObjectId } from 'mongodb'

export interface IRefreshToken extends Document {
  token: string
  created_at: Date
  user_id: ObjectId
}

const refreshTokenSchema = new Schema<IRefreshToken>({
  token: {
    type: String,
    required: true
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  user_id: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'User'
  }
})

const RefreshToken = model<IRefreshToken>('RefreshToken', refreshTokenSchema)

export default RefreshToken
