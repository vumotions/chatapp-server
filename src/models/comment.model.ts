import { Schema, model } from 'mongoose'

interface IComment {
  postId: Schema.Types.ObjectId
  userId: Schema.Types.ObjectId
  content: string
  parentId?: Schema.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const commentSchema = new Schema<IComment>(
  {
    postId: {
      type: Schema.Types.ObjectId,
      ref: 'Post',
      required: true
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    content: {
      type: String,
      required: true
    },
    parentId: {
      type: Schema.Types.ObjectId,
      ref: 'Comment'
    }
  },
  {
    timestamps: true
  }
)

// Index for faster queries
commentSchema.index({ postId: 1, createdAt: -1 })
commentSchema.index({ parentId: 1 })

const CommentModel = model<IComment>('Comment', commentSchema)

export default CommentModel