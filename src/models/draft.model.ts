import mongoose, { Document, Schema } from 'mongoose'

export interface IDraft extends Document {
  userId: mongoose.Types.ObjectId
  chatId: mongoose.Types.ObjectId
  content: string
  attachments: any[]
  createdAt: Date
  updatedAt: Date
}

const draftSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    chatId: {
      type: Schema.Types.ObjectId,
      ref: 'Chat',
      required: true
    },
    content: {
      type: String,
      default: ''
    },
    attachments: {
      type: Array,
      default: []
    }
  },
  {
    timestamps: true
  }
)

// Tạo index để tìm kiếm nhanh
draftSchema.index({ userId: 1, chatId: 1 }, { unique: true })

const DraftModel = mongoose.model<IDraft>('Draft', draftSchema)

export default DraftModel