import { Document, model, ObjectId, Schema } from 'mongoose'

export interface IPostComment extends Document {
  userId: ObjectId
  postId: ObjectId
  content: string
  parentId?: ObjectId
  createdAt: Date
  updatedAt: Date
}

const postCommentSchema = new Schema<IPostComment>(
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
    },
    content: {
      type: String,
      required: true
    },
    parentId: {
      type: Schema.Types.ObjectId,
      ref: 'PostComment',
      default: null
    }
  },
  { timestamps: true }
)

// Index for faster queries
postCommentSchema.index({ postId: 1, createdAt: -1 })
postCommentSchema.index({ parentId: 1 })

// Thêm pre-save hook để log dữ liệu trước khi lưu
postCommentSchema.pre('save', function (next) {
  console.log('Saving comment with data:', this)
  next()
})

const PostCommentModel = model<IPostComment>('PostComment', postCommentSchema)

export default PostCommentModel
