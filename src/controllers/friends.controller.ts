import { Request, Response, NextFunction } from 'express'
import { FRIEND_REQUEST_STATUS, NOTIFICATION_TYPE } from '~/constants/enums'
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
    const userId = (req.context?.user as IUser)._id as string
    const { userId: receiverId } = req.body

    if (userId.toString() === receiverId) {
      throw new AppError({ message: 'Không thể kết bạn với chính mình', status: 400 })
    }

    // Kiểm tra đã là bạn hoặc đã gửi request chưa
    const isFriend = await FriendModel.findOne({ userId, friendId: receiverId })
    const isRequested = await FriendRequestModel.findOne({ senderId: userId, receiverId })

    if (isFriend || isRequested) {
      throw new AppError({ message: 'Đã gửi lời mời hoặc đã là bạn', status: 400 })
    }

    const friendRequest = await FriendRequestModel.create({
      senderId: userId,
      receiverId,
      status: FRIEND_REQUEST_STATUS.PENDING
    })

    // Gửi thông báo
    const notification = await notificationService.createNotification({
      userId: receiverId,
      senderId: userId,
      type: NOTIFICATION_TYPE.FRIEND_REQUEST,
      relatedId: friendRequest._id
    })
    // Emit socket event
    io?.to(String(receiverId)).emit(SOCKET_EVENTS.NOTIFICATION_NEW, notification)

    res.json(new AppSuccess({ message: 'Đã gửi lời mời kết bạn', data: null }))
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

      // Tạo thông báo
      const notification = await notificationService.createNotification({
        userId: friendRequest.senderId.toString(),
        senderId: userId,
        type: NOTIFICATION_TYPE.FRIEND_ACCEPTED,
        relatedId: friendRequest._id.toString()
      })

      // Emit socket event nếu người gửi đang online
      if (io) {
        const senderSocketId = users.get(friendRequest.senderId.toString())
        if (senderSocketId) {
          console.log(
            `Sending notification to socket ${senderSocketId} (user ${friendRequest.senderId})`
          )
          io.to(senderSocketId).emit(SOCKET_EVENTS.NOTIFICATION_NEW, notification)
        }
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

      // Lấy tất cả người dùng trừ những người đã loại trừ
      const allUsers = await UserModel.find({ _id: { $nin: excludeIds } })
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

      // Thêm những người đã gửi lời mời cho mình vào danh sách gợi ý
      const receivedUsers = await UserModel.find({ _id: { $in: receivedIds } })
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
    const userId = (req.context?.user as IUser)._id as string
    const { userId: senderId } = req.body

    const request = await FriendRequestModel.findOneAndUpdate(
      { senderId, receiverId: userId, status: FRIEND_REQUEST_STATUS.PENDING },
      { status: FRIEND_REQUEST_STATUS.REJECTED }
    )
    if (!request) throw new AppError({ message: 'Không tìm thấy lời mời', status: 404 })

    res.json(new AppSuccess({ message: 'Đã từ chối lời mời kết bạn', data: null }))
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
        return res.json(new AppSuccess({ 
          message: 'Lấy trạng thái kết bạn thành công', 
          data: { status: FRIEND_REQUEST_STATUS.ACCEPTED } 
        }))
      }

      // Kiểm tra đã gửi lời mời kết bạn chưa
      const sentRequest = await FriendRequestModel.findOne({
        senderId: userId,
        receiverId: friendId,
        status: FRIEND_REQUEST_STATUS.PENDING
      })

      if (sentRequest) {
        return res.json(new AppSuccess({ 
          message: 'Lấy trạng thái kết bạn thành công', 
          data: { status: FRIEND_REQUEST_STATUS.PENDING } 
        }))
      }

      // Kiểm tra đã nhận lời mời kết bạn chưa
      const receivedRequest = await FriendRequestModel.findOne({
        senderId: friendId,
        receiverId: userId,
        status: FRIEND_REQUEST_STATUS.PENDING
      })

      if (receivedRequest) {
        return res.json(new AppSuccess({ 
          message: 'Lấy trạng thái kết bạn thành công', 
          data: { status: 'RECEIVED' } 
        }))
      }

      // Không có mối quan hệ
      return res.json(new AppSuccess({ 
        message: 'Lấy trạng thái kết bạn thành công', 
        data: { status: null } 
      }))
    } catch (error) {
      next(error)
    }
  }
}

const friendsController = new FriendsController()
export default friendsController
