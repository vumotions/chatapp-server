import { model, ObjectId, Schema } from 'mongoose'
import { FRIEND_REQUEST_STATUS } from '~/constants/enums'

export interface IFriendRequest extends Document {
  senderUserId: ObjectId
  receiverUserId: ObjectId
  status: FRIEND_REQUEST_STATUS
}

const friendRequestSchema = new Schema<IFriendRequest>(
  {
    senderUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    receiverUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    status: {
      type: String,
      enum: [
        FRIEND_REQUEST_STATUS.ACCEPTED,
        FRIEND_REQUEST_STATUS.DECLINED,
        FRIEND_REQUEST_STATUS.ACCEPTED
      ],
      default: FRIEND_REQUEST_STATUS.PENDING
    }
  },
  { timestamps: true }
)

const FriendRequestModel = model<IFriendRequest>('FriendRequest', friendRequestSchema)

export default FriendRequestModel
