import { Schema, model, Document } from 'mongoose'
import { ObjectId } from 'mongodb'

export interface IPost extends Document {
  user_id: ObjectId
  group_id?: ObjectId
  post_type?: 'private' | 'friend' | 'public'
  content: string
  allowed_users?: ObjectId[]
  shares?: number
  comment_count?: number
  created_at?: Date
  updated_at?: Date
  media?: {
    type: 'image' | 'video'
    url: string
    public_id: string
  }[]
}

const postSchema = new Schema<IPost>(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    group_id: {
      type: Schema.Types.ObjectId,
      ref: 'Group',
      required: false
    },
    post_type: {
      type: String,
      enum: ['private', 'friend', 'public'],
      default: 'public'
    },
    content: {
      type: String,
      required: true
    },
    media: [
      {
        type: {
          type: String,
          enum: ['image', 'video'],
          required: true
        },
        url: {
          type: String,
          required: true
        },
        public_id: {
          type: String,
          required: true
        }
      }
    ],
    allowed_users: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User'
      }
    ],
    shares: {
      type: Number,
      default: 0
    },
    comment_count: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
  }
)

const PostModel = model<IPost>('Post', postSchema)

export default PostModel
