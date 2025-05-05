import { model, ObjectId, Schema } from 'mongoose'

export interface IFriend extends Document {
  userId: ObjectId
  friendId: ObjectId
}

const friendSchema = new Schema<IFriend>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    friendId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  { timestamps: true }
)

const FriendModel = model<IFriend>('Friend', friendSchema)

export default FriendModel
