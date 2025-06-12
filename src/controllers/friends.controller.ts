import { NextFunction, Request, Response } from 'express'
import {
  FRIEND_REQUEST_STATUS,
  MEMBER_ROLE,
  NOTIFICATION_TYPE,
  USER_VERIFY_STATUS
} from '~/constants/enums'
import SOCKET_EVENTS from '~/constants/socket-events'
import { io, users } from '~/lib/socket'
import ChatModel from '~/models/chat.model'
import { AppError } from '~/models/error.model'
import FriendRequestModel from '~/models/friend-request.model'
import FriendModel from '~/models/friend.model'
import NotificationModel from '~/models/notification.model'
import SettingsModel from '~/models/settings.model'
import { AppSuccess } from '~/models/success.model'
import UserModel, { IUser } from '~/models/User.model'
import notificationService from '~/services/notification.service'

// Định nghĩa interface cho user suggestion
interface UserSuggestion {
  _id: string
  name: string
  avatar?: string
  username?: string
  [key: string]: any // Cho phép các trường khác
}

class FriendsController {
  async addFriend(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.context?.user as IUser)._id as string
      const { userId: receiverId } = req.body

      if (userId.toString() === receiverId) {
        throw new AppError({ message: 'Không thể kết bạn với chính mình', status: 400 })
      }

      // Kiểm tra xem người dùng có bị chặn không
      const senderSettings = await SettingsModel.findOne({ userId })
      if (
        senderSettings &&
        senderSettings.security.blockedUsers.some((id) => id.toString() === receiverId)
      ) {
        throw new AppError({
          message: 'Không thể gửi lời mời kết bạn đến người dùng bạn đã chặn',
          status: 400
        })
      }

      // Kiểm tra xem mình có bị người nhận chặn không
      const receiverSettings = await SettingsModel.findOne({ userId: receiverId })
      if (
        receiverSettings &&
        receiverSettings.security.blockedUsers.some((id) => id.toString() === userId)
      ) {
        throw new AppError({
          message: 'Không thể gửi lời mời kết bạn đến người dùng này',
          status: 400
        })
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

        // Chuẩn hóa cấu trúc thông báo - luôn gửi thông tin người gửi trong trường senderId
        const notificationToSend = {
          ...notification.toObject(),
          senderId: {
            _id: sender._id,
            name: sender.name,
            avatar: sender.avatar
          },
          content: `${sender.name} đã gửi cho bạn lời mời kết bạn` // Thêm nội dung rõ ràng
        }

        console.log(
          'Notification structure before sending:',
          JSON.stringify(notificationToSend, null, 2)
        )

        // Gửi thông báo qua socket với cấu trúc đã được chuẩn hóa
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

        // Chuẩn hóa cấu trúc thông báo - luôn gửi thông tin người gửi trong trường senderId
        const notificationToSend = {
          ...notification.toObject(),
          senderId: {
            _id: accepter?._id,
            name: accepter?.name,
            avatar: accepter?.avatar
          }
        }

        // Gửi thông báo qua socket với cấu trúc đã được chuẩn hóa
        io.to(receiverSocketId).emit(SOCKET_EVENTS.NOTIFICATION_NEW, notificationToSend)

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
      const page = parseInt(req.query.page as string) || 1
      const limit = parseInt(req.query.limit as string) || 10

      // Lấy tất cả user đã là bạn
      const friends = await FriendModel.find({ userId }).select('friendId')
      const userFriendIds = friends.map((f) => f.friendId.toString())

      // Lấy danh sách lời mời đã gửi/nhận
      const sentRequests = await FriendRequestModel.find({
        senderId: userId,
        status: FRIEND_REQUEST_STATUS.PENDING
      }).select('receiverId')
      const receivedRequests = await FriendRequestModel.find({
        receiverId: userId,
        status: FRIEND_REQUEST_STATUS.PENDING
      }).select('senderId')

      // IDs cần loại trừ
      const excludeIds = [userId, ...userFriendIds]
      const pendingIds = sentRequests.map((r) => r.receiverId.toString())
      const receivedIds = receivedRequests.map((r) => r.senderId.toString())

      // Lấy bạn của bạn (mối quan hệ bậc 2) - ưu tiên cao nhất
      const friendsOfFriends = await FriendModel.find({
        userId: { $in: userFriendIds },
        friendId: { $nin: [...excludeIds, ...receivedIds] }
      })
        .select('friendId')
        .limit(limit * 2)

      const fofIds = friendsOfFriends.map((f) => f.friendId.toString())

      // Đếm tổng số người dùng thỏa mãn điều kiện
      const totalCount = await UserModel.countDocuments({
        _id: { $nin: excludeIds },
        verify: USER_VERIFY_STATUS.VERIFIED
      })

      // Thêm những người đã gửi lời mời cho mình vào danh sách gợi ý
      const receivedUsers = await UserModel.find({
        _id: { $in: receivedIds },
        verify: USER_VERIFY_STATUS.VERIFIED
      })
        .select('_id name avatar username')
        .lean()

      const receivedSuggestions = receivedUsers.map((user) => ({
        ...user,
        mutualFriends: 0,
        status: 'RECEIVED'
      }))

      // Số lượng gợi ý cần lấy sau khi đã có receivedSuggestions
      const remainingLimit = limit - receivedSuggestions.length

      // Tính toán skip đúng cho phân trang
      // Nếu là page 1, không skip bạn của bạn
      // Nếu là page > 1, skip qua (page-1)*limit người dùng
      const effectiveSkip = page === 1 ? 0 : (page - 1) * limit

      // Lấy người dùng ưu tiên (bạn của bạn) nếu là page 1
      let priorityUsers = [] as any[]
      if (page === 1) {
        priorityUsers = await UserModel.find({
          _id: { $in: fofIds },
          verify: USER_VERIFY_STATUS.VERIFIED
        })
          .select('_id name avatar username')
          .limit(remainingLimit)
          .lean()
      }

      // Nếu chưa đủ limit, lấy thêm người dùng khác
      const remainingForOthers = remainingLimit - priorityUsers.length
      const otherUsers =
        remainingForOthers > 0
          ? await UserModel.find({
              _id: { $nin: [...excludeIds, ...receivedIds, ...fofIds] },
              verify: USER_VERIFY_STATUS.VERIFIED
            })
              .select('_id name avatar username')
              .skip(page === 1 ? 0 : effectiveSkip - fofIds.length)
              .limit(remainingForOthers)
              .lean()
          : []

      // Kết hợp kết quả
      const allUsers = [...priorityUsers, ...otherUsers]

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

      // Kết hợp cả hai danh sách - chỉ hiển thị receivedSuggestions ở page 1
      const combinedSuggestions =
        page === 1 ? [...receivedSuggestions, ...suggestions] : suggestions

      res.json(
        new AppSuccess({
          data: {
            suggestions: combinedSuggestions,
            pagination: {
              total: totalCount + (page === 1 ? receivedUsers.length : 0),
              page,
              limit,
              totalPages: Math.ceil(totalCount / limit) + (receivedUsers.length > 0 ? 1 : 0)
            }
          },
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
    try {
      const userId = (req.context?.user as IUser)._id as string
      const searchQuery = (req.query.search as string) || ''

      // Lấy danh sách bạn bè
      const friends = await FriendModel.find({ userId })
        .populate('friendId', '_id name avatar username') // Đảm bảo trường username được chọn
        .lean()

      // Lọc bạn bè theo tìm kiếm nếu có searchQuery
      let filteredFriends = friends.map((f) => f.friendId)

      if (searchQuery) {
        filteredFriends = filteredFriends.filter((friend: any) =>
          friend.name.toLowerCase().includes(searchQuery.toLowerCase())
        )
      }

      res.json(
        new AppSuccess({
          message: 'Lấy danh sách bạn bè thành công',
          data: filteredFriends
        })
      )
    } catch (error) {
      next(error)
    }
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

  // Thêm phương thức searchUsers để tìm kiếm tất cả người dùng
  async searchUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const searchQuery = (req.query.q as string) || ''
      const userId = (req.context?.user as IUser)._id as string

      // Nếu không có từ khóa tìm kiếm, trả về mảng rỗng
      if (!searchQuery.trim()) {
        res.json(
          new AppSuccess({
            message: 'Search results',
            data: []
          })
        )
        return
      }

      // Tìm kiếm người dùng theo tên hoặc username, chỉ lấy người dùng đã xác minh
      // và không phải là chính người dùng hiện tại
      const users = await UserModel.find({
        $and: [
          { _id: { $ne: userId } }, // Không phải là người dùng hiện tại
          { verify: USER_VERIFY_STATUS.VERIFIED }, // Đã xác minh
          {
            $or: [
              { name: { $regex: searchQuery, $options: 'i' } }, // Tìm theo tên
              { username: { $regex: searchQuery, $options: 'i' } } // Tìm theo username
            ]
          }
        ]
      })
        .select('_id name username avatar')
        .limit(10)
        .lean()

      res.json(
        new AppSuccess({
          message: 'Search results',
          data: users
        })
      )
    } catch (error) {
      next(error)
    }
  }

  // Thêm controller mới để lấy danh sách bạn bè theo username
  async getFriendsByUsername(req: Request, res: Response, next: NextFunction) {
    try {
      const { username } = req.params

      // Tìm user theo username
      const user = await UserModel.findOne({ username })
      if (!user) {
        throw new AppError({ message: 'Không tìm thấy người dùng', status: 404 })
      }

      // Lấy danh sách bạn bè của user này
      const friends = await FriendModel.find({ userId: user._id })
        .populate('friendId', '_id name avatar username')
        .lean()

      // Chuyển đổi kết quả để phù hợp với định dạng trả về
      const friendsList = friends.map((friend) => friend.friendId)

      res.json(
        new AppSuccess({
          message: 'Lấy danh sách bạn bè thành công',
          data: friendsList
        })
      )
    } catch (error) {
      next(error)
    }
  }

  // Lấy danh sách bạn bè với roles trong các nhóm chat
  async getFriendsWithRoles(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.context?.user as IUser)._id as string
      const { conversationId } = req.query

      if (!conversationId) {
        throw new AppError({ message: 'Thiếu ID cuộc trò chuyện', status: 400 })
      }

      // Lấy thông tin về cuộc trò chuyện
      const conversation = await ChatModel.findById(conversationId)
      if (!conversation) {
        throw new AppError({ message: 'Không tìm thấy cuộc trò chuyện', status: 404 })
      }

      // Kiểm tra người dùng có trong cuộc trò chuyện không
      const isMember = conversation.participants.some((p) => p.toString() === userId.toString())
      if (!isMember) {
        throw new AppError({
          message: 'Bạn không phải thành viên của cuộc trò chuyện này',
          status: 403
        })
      }

      // Lấy thông tin về vai trò của người dùng hiện tại
      const currentMember = conversation.members?.find(
        (m) => m.userId.toString() === userId.toString()
      )

      const isAdmin = currentMember?.role === 'ADMIN' || currentMember?.role === 'OWNER'

      // Lấy danh sách tất cả thành viên trong nhóm
      const memberIds = conversation.participants.map((p) => p.toString())

      // Lấy thông tin chi tiết của tất cả thành viên
      const allMembers = await UserModel.find({ _id: { $in: memberIds } })
        .select('_id name avatar username')
        .lean()

      // Kết hợp thông tin thành viên với vai trò trong nhóm
      const membersWithRoles = allMembers.map((member) => {
        // Tìm thông tin thành viên trong nhóm
        const memberInfo = conversation.members?.find(
          (m) => m.userId.toString() === member._id.toString()
        )

        return {
          ...member,
          inGroup: true,
          role: memberInfo?.role || 'MEMBER',
          permissions: isAdmin ? memberInfo?.permissions : null, // Chỉ trả về permissions nếu là admin
          customTitle: memberInfo?.customTitle || null
        }
      })

      // Sắp xếp danh sách: Owner đầu tiên, sau đó là Admin, cuối cùng là Member
      const sortedMembers = membersWithRoles.sort((a, b) => {
        // Hàm helper để chuyển role thành số để so sánh
        const getRoleWeight = (role: string) => {
          switch (role) {
            case 'OWNER':
              return 0
            case 'ADMIN':
              return 1
            default:
              return 2 // MEMBER hoặc các role khác
          }
        }

        const roleWeightA = getRoleWeight(a.role)
        const roleWeightB = getRoleWeight(b.role)

        // So sánh theo role trước
        if (roleWeightA !== roleWeightB) {
          return roleWeightA - roleWeightB
        }

        // Nếu cùng role, sắp xếp theo tên
        return (a?.name || '').localeCompare(b?.name || '')
      })

      res.json(
        new AppSuccess({
          message: 'Lấy danh sách thành viên với vai trò thành công',
          data: {
            members: sortedMembers,
            isAdmin // Thêm trường isAdmin để client biết người dùng có quyền admin không
          }
        })
      )
    } catch (error) {
      next(error)
    }
  }
}

const friendsController = new FriendsController()
export default friendsController
