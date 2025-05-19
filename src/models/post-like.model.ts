import { Document, model, ObjectId, Schema } from 'mongoose'

export interface IPostLike extends Document {
  userId: ObjectId
  postId: ObjectId
  createdAt: Date
}

const postLikeSchema = new Schema<IPostLike>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    postId: {
      type: Schema.Types.ObjectId,
      ref: 'Post',
      required: true
    }
  },
  { timestamps: true }
)

// Create a compound index to ensure a user can only like a post once
postLikeSchema.index({ userId: 1, postId: 1 }, { unique: true })

const PostLikeModel = model<IPostLike>('PostLike', postLikeSchema)

export default PostLikeModel