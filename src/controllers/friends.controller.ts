import { Request, Response, NextFunction } from 'express'
import { FRIEND_REQUEST_STATUS, NOTIFICATION_TYPE, USER_VERIFY_STATUS } from '~/constants/enums'
import { AppError } from '~/models/error.model'
import FriendRequestModel from '~/models/friend-request.model'
import FriendModel from '~/models/friend.model'
import NotificationModel from '~/models/notification.model'
import { AppSuccess } from '~/models/success.model'
import { IUser } from '~/models/user.model'
import notificationService from '~/services/notification.service'
import UserModel from '~/models/user.model'
import { io, users } from '~/lib/socket'
import SOCKET_EVENTS from '~/constants/socket-events'
import mongoose, { ObjectId } from 'mongoose'

class FriendsController {
  async addFriend(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.context?.user as IUser)._id as string
      const { userId: receiverId } = req.body

      if (userId.toString() === receiverId) {
        throw new AppError({ message: 'Không thể kết bạn với chính mình', status: 400 })
      }

      // Kiểm tra đã là bạn chưa
      const isFriend = await FriendModel.findOne({ userId, friendId: receiverId })
      if (isFriend) {
        throw new AppError({ message: 'Đã là bạn', status: 400 })
      }

      // Kiểm tra đã gửi lời mời chưa (chỉ kiểm tra lời mời PENDING)
      const isRequested = await FriendRequestModel.findOne({
        senderId: userId,
        receiverId,
        status: FRIEND_REQUEST_STATUS.PENDING
      })
      if (isRequested) {
        throw new AppError({ message: 'Đã gửi lời mời kết bạn', status: 400 })
      }

      // Lấy thông tin người gửi
      const sender = await UserModel.findById(userId).select('_id name avatar').lean()

      if (!sender) {
        throw new AppError({ message: 'Không tìm thấy thông tin người gửi', status: 500 })
      }

      let friendRequest
      let existingNotification

      // Kiểm tra xem có lời mời bị từ chối trước đó không
      const rejectedRequest = await FriendRequestModel.findOne({
        senderId: userId,
        receiverId,
        status: FRIEND_REQUEST_STATUS.REJECTED
      })

      // Nếu có lời mời bị từ chối trước đó, cập nhật lại thành PENDING
      if (rejectedRequest) {
        rejectedRequest.status = FRIEND_REQUEST_STATUS.PENDING
        await rejectedRequest.save()
        friendRequest = rejectedRequest

        // Kiểm tra xem đã có thông báo cho lời mời này chưa
        existingNotification = await NotificationModel.findOne({
          userId: receiverId,
          senderId: userId,
          type: NOTIFICATION_TYPE.FRIEND_REQUEST,
          relatedId: rejectedRequest._id
        })
      } else {
        // Tạo mới lời mời kết bạn
        friendRequest = await FriendRequestModel.create({
          senderId: userId,
          receiverId,
          status: FRIEND_REQUEST_STATUS.PENDING
        })
      }

      // Xử lý thông báo
      let notification

      if (existingNotification) {
        // Nếu đã có thông báo, cập nhật lại trạng thái
        existingNotification.processed = false
        existingNotification.read = false
        existingNotification.set('createdAt', new Date())
        await existingNotification.save()
        notification = existingNotification
      } else {
        // Tạo mới thông báo nếu chưa có
        notification = await NotificationModel.create({
          userId: receiverId,
          senderId: userId,
          type: NOTIFICATION_TYPE.FRIEND_REQUEST,
          relatedId: friendRequest._id
        })
      }

      // Lấy socketId của người nhận
      const receiverSocketId = users.get(String(receiverId))

      if (receiverSocketId) {
        console.log(`Emitting notification to user ${receiverId} with socketId ${receiverSocketId}`)

        // Đảm bảo thông tin người gửi đầy đủ
        const notificationToSend = {
          ...notification.toObject(),
          senderId: {
            _id: sender._id,
            name: sender.name,
            avatar: sender.avatar
          }
        }

        console.log(
          'Notification structure before sending:',
          JSON.stringify(notificationToSend, null, 2)
        )

        // Gửi thông báo qua socket với cấu trúc đã được điều chỉnh
        io.to(receiverSocketId).emit(SOCKET_EVENTS.NOTIFICATION_NEW, notificationToSend)

        console.log('Notification sent successfully')
      } else {
        console.log(`User ${receiverId} is not online, notification will be shown when they log in`)
      }

      const message = rejectedRequest ? 'Đã gửi lại lời mời kết bạn' : 'Đã gửi lời mời kết bạn'
      res.json(new AppSuccess({ message, data: null }))
    } catch (error) {
      next(error)
    }
  }

  async acceptFriendRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.context?.user as IUser)._id as string
      const { userId: senderId } = req.body

      // Tìm lời mời kết bạn
      const friendRequest = await FriendRequestModel.findOne({
        senderId,
        receiverId: userId,
        status: FRIEND_REQUEST_STATUS.PENDING
      })

      if (!friendRequest) {
        throw new AppError({
          message: 'Không tìm thấy lời mời kết bạn',
          status: 404
        })
      }

      // Cập nhật trạng thái lời mời
      friendRequest.status = FRIEND_REQUEST_STATUS.ACCEPTED
      await friendRequest.save()

      // Tạo mối quan hệ bạn bè hai chiều
      await FriendModel.create({
        userId,
        friendId: friendRequest.senderId
      })

      await FriendModel.create({
        userId: friendRequest.senderId,
        friendId: userId
      })

      // Lấy thông tin người chấp nhận lời mời
      const accepter = await UserModel.findById(userId).select('_id name avatar').lean()

      // Tạo thông báo
      const notification = await NotificationModel.create({
        userId: friendRequest.senderId.toString(),
        senderId: userId,
        type: NOTIFICATION_TYPE.FRIEND_ACCEPTED,
        relatedId: friendRequest._id.toString()
      })

      // Lấy socketId của người nhận
      const receiverSocketId = users.get(String(friendRequest.senderId))

      if (receiverSocketId) {
        console.log(
          `Emitting friend acceptance notification to user ${friendRequest.senderId} with socketId ${receiverSocketId}`
        )

        // Gửi thông báo qua socket
        io.to(receiverSocketId).emit(SOCKET_EVENTS.NOTIFICATION_NEW, {
          ...notification.toObject(),
          sender: accepter
        })

        console.log('Notification sent successfully')
      } else {
        console.log(
          `User ${friendRequest.senderId} is not online, notification will be shown when they log in`
        )
      }

      res.json(new AppSuccess({ message: 'Đã chấp nhận lời mời kết bạn', data: null }))
    } catch (error) {
      next(error)
    }
  }

  async getFriendSuggestions(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.context?.user as IUser)._id as string

      // Lấy tất cả user đã là bạn
      const friends = await FriendModel.find({ userId }).select('friendId')

      // Lấy danh sách lời mời đã gửi
      const sentRequests = await FriendRequestModel.find({
        senderId: userId,
        status: FRIEND_REQUEST_STATUS.PENDING
      }).select('receiverId')

      // Lấy danh sách lời mời đã nhận
      const receivedRequests = await FriendRequestModel.find({
        receiverId: userId,
        status: FRIEND_REQUEST_STATUS.PENDING
      }).select('senderId')

      // Chỉ loại trừ chính mình và những người đã là bạn
      const excludeIds = [userId, ...friends.map((f) => f.friendId)]

      // Lấy danh sách ID người đã nhận lời mời từ mình
      const pendingIds = sentRequests.map((r) => r.receiverId.toString())

      // Lấy danh sách ID người đã gửi lời mời cho mình
      const receivedIds = receivedRequests.map((r) => r.senderId.toString())

      // Lấy user chưa là bạn, bao gồm cả những người đã nhận lời mời từ mình
      const userFriends = await FriendModel.find({ userId }).select('friendId')
      const userFriendIds = userFriends.map((f) => f.friendId.toString())

      // Lấy tất cả người dùng trừ những người đã loại trừ, CHỈ LẤY NGƯỜI DÙNG ĐÃ XÁC MINH
      const allUsers = await UserModel.find({
        _id: { $nin: excludeIds },
        verify: USER_VERIFY_STATUS.VERIFIED // Sử dụng enum
      })
        .select('_id name avatar')
        .limit(10)
        .lean()

      // Tính mutualFriends và thêm trạng thái cho từng người
      const suggestions = await Promise.all(
        allUsers.map(async (user) => {
          try {
            const suggestionFriends = await FriendModel.find({ userId: user._id }).select(
              'friendId'
            )
            const suggestionFriendIds = suggestionFriends.map((f) => f.friendId.toString())

            // Đếm số bạn chung
            const mutualFriends = userFriendIds.filter((id) =>
              suggestionFriendIds.includes(id)
            ).length

            // Thêm trạng thái PENDING nếu người dùng đã gửi lời mời cho họ
            const status = pendingIds.includes(user._id.toString())
              ? FRIEND_REQUEST_STATUS.PENDING
              : null

            return {
              ...user,
              mutualFriends,
              status
            }
          } catch (error) {
            console.error('Error processing suggestion:', error)
            return {
              ...user,
              mutualFriends: 0,
              status: null
            }
          }
        })
      )

      // Thêm những người đã gửi lời mời cho mình vào danh sách gợi ý, CHỈ LẤY NGƯỜI DÙNG ĐÃ XÁC MINH
      const receivedUsers = await UserModel.find({
        _id: { $in: receivedIds },
        verify: USER_VERIFY_STATUS.VERIFIED // Sử dụng enum
      })
        .select('_id name avatar')
        .lean()

      const receivedSuggestions = receivedUsers.map((user) => ({
        ...user,
        mutualFriends: 0, // Có thể tính số bạn chung nếu cần
        status: 'RECEIVED' // Đánh dấu là đã nhận lời mời
      }))

      // Kết hợp cả hai danh sách
      const combinedSuggestions = [...receivedSuggestions, ...suggestions]

      res.json(
        new AppSuccess({
          data: combinedSuggestions,
          message: 'Lấy danh sách bạn bè gợi ý thành công'
        })
      )
    } catch (error) {
      next(error)
    }
  }

  async rejectFriendRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.context?.user as IUser)._id as string
      const { userId: senderId } = req.body

      // Tìm lời mời kết bạn
      const request = await FriendRequestModel.findOne({
        senderId,
        receiverId: userId,
        status: FRIEND_REQUEST_STATUS.PENDING
      })

      if (!request) {
        throw new AppError({ message: 'Không tìm thấy lời mời', status: 404 })
      }

      // Cập nhật trạng thái thành REJECTED thay vì xóa
      request.status = FRIEND_REQUEST_STATUS.REJECTED
      await request.save()

      // Cập nhật thông báo liên quan là đã xử lý
      await NotificationModel.updateMany({ relatedId: request._id }, { $set: { processed: true } })

      res.json(new AppSuccess({ message: 'Đã từ chối lời mời kết bạn', data: null }))
    } catch (error) {
      next(error)
    }
  }

  async getFriendsList(req: Request, res: Response, next: NextFunction) {
    const userId = (req.context?.user as IUser)._id as string
    const friends = await FriendModel.find({ userId }).populate('friendId', 'name avatar')
    res.json(
      new AppSuccess({
        message: 'Lấy danh sách bạn bè thành công',
        data: friends.map((f) => f.friendId)
      })
    )
  }

  async cancelFriendRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.context?.user as IUser)._id as string
      const { userId: receiverId } = req.body

      const request = await FriendRequestModel.findOneAndDelete({
        senderId: userId,
        receiverId,
        status: FRIEND_REQUEST_STATUS.PENDING
      })

      if (!request) {
        throw new AppError({ message: 'Không tìm thấy lời mời', status: 404 })
      }

      // Xóa thông báo liên quan nếu có
      await notificationService.deleteNotificationByRelatedId(request._id)

      res.json(new AppSuccess({ message: 'Đã hủy lời mời kết bạn', data: null }))
    } catch (error) {
      next(error)
    }
  }

  // Xóa bạn bè
  async removeFriend(req: Request, res: Response, next: NextFunction) {
    try {
      const { friendId } = req.params
      const userId = (req.context?.user as IUser)._id as string

      // Xóa cả hai bản ghi kết bạn (A-B và B-A)
      await FriendModel.deleteMany({
        $or: [
          { userId, friendId },
          { userId: friendId, friendId: userId }
        ]
      })

      // Xóa tất cả các yêu cầu kết bạn giữa hai người dùng
      await FriendRequestModel.deleteMany({
        $or: [
          { senderId: userId, receiverId: friendId },
          { senderId: friendId, receiverId: userId }
        ]
      })

      res.json(new AppSuccess({ message: 'Đã xóa bạn bè thành công', data: null }))
    } catch (error) {
      next(error)
    }
  }

  async getFriendStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.context?.user as IUser)._id as string
      const { friendId } = req.params

      if (!friendId) {
        throw new AppError({ message: 'Thiếu thông tin người dùng', status: 400 })
      }

      // Kiểm tra đã là bạn bè chưa
      const isFriend = await FriendModel.findOne({
        userId,
        friendId
      })

      if (isFriend) {
        res.json(
          new AppSuccess({
            message: 'Lấy trạng thái kết bạn thành công',
            data: { status: FRIEND_REQUEST_STATUS.ACCEPTED }
          })
        )
        return
      }

      // Kiểm tra đã gửi lời mời kết bạn chưa
      const sentRequest = await FriendRequestModel.findOne({
        senderId: userId,
        receiverId: friendId,
        status: FRIEND_REQUEST_STATUS.PENDING
      })

      if (sentRequest) {
        res.json(
          new AppSuccess({
            message: 'Lấy trạng thái kết bạn thành công',
            data: { status: FRIEND_REQUEST_STATUS.PENDING }
          })
        )
        return
      }

      // Kiểm tra đã nhận lời mời kết bạn chưa
      const receivedRequest = await FriendRequestModel.findOne({
        senderId: friendId,
        receiverId: userId,
        status: FRIEND_REQUEST_STATUS.PENDING
      })

      if (receivedRequest) {
        res.json(
          new AppSuccess({
            message: 'Lấy trạng thái kết bạn thành công',
            data: { status: 'RECEIVED' }
          })
        )
        return
      }

      // Không có mối quan hệ
      res.json(
        new AppSuccess({
          message: 'Lấy trạng thái kết bạn thành công',
          data: { status: null }
        })
      )
    } catch (error) {
      next(error)
    }
  }
}

const friendsController = new FriendsController()
export default friendsController
