import { Document, Schema, model } from 'mongoose'
import { ObjectId } from 'mongodb'

export interface IPost extends Document {
  userId: ObjectId
  content: string
  media?: Array<{
    url: string
    type: string
    public_id?: string
  }>
  post_type: 'public' | 'friends' | 'private'
  likes?: Array<ObjectId>
  comments?: Array<ObjectId>
  shared_post?: ObjectId
  created_at: Date
  updated_at: Date
}

const postSchema = new Schema<IPost>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    content: {
      type: String,
      required: function(this: IPost) {
        return !this.media?.length && !this.shared_post
      }
    },
    media: {
      type: [{
        url: { type: String, required: true },
        type: { type: String, required: true },
        public_id: { type: String }
      }],
      default: []
    },
    post_type: {
      type: String,
      enum: ['public', 'friends', 'private'],
      default: 'public'
    },
    likes: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User'
      }
    ],
    comments: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Comment'
      }
    ],
    shared_post: {
      type: Schema.Types.ObjectId,
      ref: 'Post'
    },
    created_at: {
      type: Date,
      default: Date.now
    },
    updated_at: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: false }
)

const PostModel = model<IPost>('Post', postSchema)

export default PostModel
