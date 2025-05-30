import { NextFunction, Request, Response } from 'express'
import { omit } from 'lodash'
import { AppError } from '~/models/error.model'
import { AppSuccess } from '~/models/success.model'
import UserModel, { IUser } from '~/models/User.model'
import { UpdateMyProfileDTO } from '~/schemas/user/update-profile.schema'
import userService from '~/services/user.service'
import SettingsModel from '~/models/settings.model'
import FriendModel from '~/models/friend.model'
import FriendRequestModel from '~/models/friend-request.model'
import mongoose from 'mongoose'
import { UpdateSettingsDTO } from '~/schemas/user/update-settings.schema'

class UsersController {
  getMyProfile(req: Request, res: Response, next: NextFunction) {
    res.json(
      new AppSuccess({
        message: 'Get profile successfully',
        data: req.context?.user
      })
    )
  }

  async updateMyProfile(
    req: Request<any, any, UpdateMyProfileDTO>,
    res: Response,
    next: NextFunction
  ) {
    const user = req.context?.user
    const updatedUser = await userService.updateProfile({
      userId: user?._id as string,
      body: req.body
    })

    res.json(
      new AppSuccess({
        message: 'Your profile has been updated successfully',
        data: omit(updatedUser?.toObject(), ['passwordHash'])
      })
    )
  }

  // Add new method to get user by ID
  async getUserById(req: Request, res: Response, next: NextFunction) {
    const userId = req.params.userId

    // Kiểm tra xem userId có phải là ObjectId hợp lệ không
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      next(
        new AppError({
          status: 400, // BAD_REQUEST
          message: 'Invalid user ID format'
        })
      )
      return
    }

    try {
      const user = await UserModel.findById(userId)

      if (!user) {
        next(
          new AppError({
            status: 404, // NOT_FOUND
            message: 'User not found'
          })
        )
        return
      }

      res.json(
        new AppSuccess({
          message: 'User found successfully',
          data: {
            _id: user._id,
            name: user.name,
            username: user.username,
            avatar: user.avatar,
            bio: user.bio
          }
        })
      )
    } catch (error) {
      next(error)
    }
  }

  // Add new method to get user by username
  async getUserByUsername(req: Request, res: Response, next: NextFunction) {
    const username = req.params.username

    try {
      const user = await userService.getUserByUsername(username)

      if (!user) {
        next(
          new AppError({
            status: 404, // NOT_FOUND
            message: 'User not found'
          })
        )
        return
      }

      res.json(
        new AppSuccess({
          message: 'User found successfully',
          data: omit(user.toObject(), ['passwordHash', 'provider', 'providerId'])
        })
      )
    } catch (error) {
      next(error)
    }
  }

  async blockUser(req: Request, res: Response, next: NextFunction) {
    try {
      const currentUserId = (req.context?.user as IUser)._id as any
      let userToBlockId = req.body.userId

      console.log('Current user ID:', currentUserId)
      console.log('User to block data:', userToBlockId)

      // Kiểm tra nếu userToBlockId là một đối tượng thay vì chuỗi
      if (typeof userToBlockId === 'object' && userToBlockId !== null) {
        // Nếu là đối tượng, lấy _id từ đối tượng đó
        userToBlockId = userToBlockId._id
      }

      console.log('Extracted user ID to block:', userToBlockId)

      // Kiểm tra không thể tự block chính mình
      if (currentUserId.toString() === userToBlockId.toString()) {
        throw new AppError({
          message: 'Không thể chặn chính mình',
          status: 400
        })
      }

      // Kiểm tra xem userToBlockId có phải là ObjectId hợp lệ không
      if (!mongoose.Types.ObjectId.isValid(userToBlockId)) {
        throw new AppError({
          message: 'ID người dùng không hợp lệ',
          status: 400
        })
      }

      // Kiểm tra user cần block có tồn tại không
      const userToBlock = await UserModel.findById(userToBlockId)
      if (!userToBlock) {
        throw new AppError({
          message: 'Người dùng không tồn tại',
          status: 404
        })
      }

      // Tìm hoặc tạo settings cho user hiện tại
      let settings = await SettingsModel.findOne({ userId: currentUserId })
      if (!settings) {
        settings = await SettingsModel.create({ userId: currentUserId })
      }

      // Kiểm tra xem đã block chưa
      const isAlreadyBlocked = settings.security.blockedUsers.some(
        (id) => id.toString() === userToBlockId.toString()
      )

      if (isAlreadyBlocked) {
        throw new AppError({
          message: 'Người dùng này đã bị chặn',
          status: 400
        })
      }

      // Chuyển đổi userToBlockId thành ObjectId và thêm vào danh sách chặn
      const objectId = new mongoose.Types.ObjectId(userToBlockId)

      // Sử dụng $addToSet để tránh trùng lặp
      await SettingsModel.updateOne(
        { userId: currentUserId },
        { $addToSet: { 'security.blockedUsers': objectId } }
      )

      // Xóa các mối quan hệ bạn bè nếu có
      await FriendModel.deleteMany({
        $or: [
          { userId: currentUserId, friendId: userToBlockId },
          { userId: userToBlockId, friendId: currentUserId }
        ]
      })

      // Xóa các yêu cầu kết bạn nếu có
      await FriendRequestModel.deleteMany({
        $or: [
          { senderId: currentUserId, receiverId: userToBlockId },
          { senderId: userToBlockId, receiverId: currentUserId }
        ]
      })

      res.json(
        new AppSuccess({
          message: 'Đã chặn người dùng thành công',
          data: { blockedUserId: userToBlockId }
        })
      )
    } catch (error) {
      console.error('Error in blockUser:', error)
      next(error)
    }
  }

  async unblockUser(req: Request, res: Response, next: NextFunction) {
    try {
      const currentUserId = (req.context?.user as IUser)._id
      const { userId: userToUnblockId } = req.body

      // Tìm settings của user hiện tại
      const settings = await SettingsModel.findOne({ userId: currentUserId })
      if (!settings) {
        throw new AppError({
          message: 'Không tìm thấy cài đặt người dùng',
          status: 404
        })
      }

      // Kiểm tra xem có trong danh sách chặn không
      const blockedIndex = settings.security.blockedUsers.findIndex(
        (id) => id.toString() === userToUnblockId
      )

      if (blockedIndex === -1) {
        throw new AppError({
          message: 'Người dùng này không bị chặn',
          status: 400
        })
      }

      // Xóa khỏi danh sách chặn
      settings.security.blockedUsers.splice(blockedIndex, 1)
      await settings.save()

      res.json(
        new AppSuccess({
          message: 'Đã bỏ chặn người dùng thành công',
          data: { unblockedUserId: userToUnblockId }
        })
      )
    } catch (error) {
      next(error)
    }
  }

  async getBlockedUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const currentUserId = (req.context?.user as IUser)._id

      // Tìm settings của người dùng hiện tại
      const settings = await SettingsModel.findOne({ userId: currentUserId })

      if (!settings) {
        res.json(
          new AppSuccess({
            message: 'Danh sách người dùng bị chặn',
            data: { blockedUsers: [] }
          })
        )
        return
      }

      // Lấy thông tin chi tiết của người dùng bị chặn
      const blockedUserIds = settings.security.blockedUsers
      const blockedUsers = await UserModel.find(
        { _id: { $in: blockedUserIds } },
        { passwordHash: 0 } // Loại bỏ thông tin nhạy cảm
      )

      res.json(
        new AppSuccess({
          message: 'Danh sách người dùng bị chặn',
          data: { blockedUsers }
        })
      )
    } catch (error) {
      next(error)
    }
  }

  async isBlockedByUser(req: Request, res: Response, next: NextFunction) {
    try {
      const currentUserId = (req.context?.user as IUser)._id
      const { userId } = req.params

      // Kiểm tra xem userId có hợp lệ không
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        res.json(
          new AppSuccess({
            message: 'Kiểm tra trạng thái chặn',
            data: { isBlocked: false }
          })
        )
        return
      }

      // Tìm settings của người dùng khác
      const otherUserSettings = await SettingsModel.findOne({ userId })

      // Kiểm tra xem người dùng hiện tại có bị chặn không
      const isBlocked =
        otherUserSettings?.security.blockedUsers.some(
          (id) => id.toString() === currentUserId?.toString()
        ) || false

      res.json(
        new AppSuccess({
          message: 'Kiểm tra trạng thái chặn',
          data: { isBlocked }
        })
      )
    } catch (error) {
      next(error)
    }
  }

  async updateSettings(
    req: Request<any, any, UpdateSettingsDTO>,
    res: Response,
    next: NextFunction
  ) {
    try {
      const userId = req.context?.user?._id
      const { language, theme } = req.body

      // Tìm hoặc tạo settings cho user
      let settings = await SettingsModel.findOne({ userId })
      if (!settings) {
        settings = await SettingsModel.create({ userId })
      }

      // Cập nhật preferences
      if (language) {
        settings.preferences.language = language
      }

      if (theme) {
        settings.preferences.theme = theme
      }

      await settings.save()

      res.json(
        new AppSuccess({
          message: 'Settings updated successfully',
          data: {
            preferences: settings.preferences
          }
        })
      )
    } catch (error) {
      next(error)
    }
  }

  async getSettings(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.context?.user?._id

      // Tìm settings của user
      let settings = await SettingsModel.findOne({ userId })

      // Nếu không có settings, tạo mới với giá trị mặc định
      if (!settings) {
        settings = await SettingsModel.create({ userId })
      }

      res.json(
        new AppSuccess({
          message: 'Settings retrieved successfully',
          data: {
            preferences: settings.preferences,
            privacy: settings.privacy
          }
        })
      )
    } catch (error) {
      next(error)
    }
  }
}

const userController = new UsersController()
export default userController
