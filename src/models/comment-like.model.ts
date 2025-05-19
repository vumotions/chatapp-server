import { Document, model, ObjectId, Schema } from 'mongoose'

export interface ICommentLike extends Document {
  userId: ObjectId
  commentId: ObjectId
  createdAt: Date
}

const commentLikeSchema = new Schema<ICommentLike>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    commentId: {
      type: Schema.Types.ObjectId,
      ref: 'PostComment',
      required: true
    }
  },
  { timestamps: true }
)

// Create a compound index to ensure a user can only like a comment once
commentLikeSchema.index({ userId: 1, commentId: 1 }, { unique: true })

const CommentLikeModel = model<ICommentLike>('CommentLike', commentLikeSchema)

export default CommentLikeModel