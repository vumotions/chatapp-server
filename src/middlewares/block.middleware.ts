import { NextFunction, Request, Response } from 'express'
import mongoose from 'mongoose'
import { AppError } from '~/models/error.model'
import SettingsModel from '~/models/settings.model'
import { IUser } from '~/models/User.model'

/**
 * Middleware kiểm tra xem người dùng hiện tại có bị người dùng khác chặn không
 * @param userIdParamName Tên tham số chứa ID người dùng cần kiểm tra (mặc định là 'userId')
 */
export const checkBlockedByUserMiddleware = (userIdParamName = 'userId') => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const currentUserId = (req.context?.user as IUser)?._id
      if (!currentUserId) {
        return next(
          new AppError({
            message: 'Unauthorized',
            status: 401
          })
        )
      }

      // Lấy ID người dùng từ params hoặc body
      const targetUserId = req.params[userIdParamName] || req.body[userIdParamName]

      if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) {
        return next()
      }

      // Kiểm tra xem người dùng hiện tại có bị chặn không
      const targetUserSettings = await SettingsModel.findOne({ userId: targetUserId })

      if (
        targetUserSettings &&
        targetUserSettings.security.blockedUsers.some(
          (id) => id.toString() === currentUserId.toString()
        )
      ) {
        return next(
          new AppError({
            message: 'Bạn không thể thực hiện hành động này vì đã bị người dùng chặn',
            status: 403,
            name: 'USER_BLOCKED_ERROR'
          })
        )
      }

      next()
    } catch (error) {
      next(error)
    }
  }
}

/**
 * Middleware kiểm tra xem người dùng hiện tại có chặn người dùng khác không
 * @param userIdParamName Tên tham số chứa ID người dùng cần kiểm tra (mặc định là 'userId')
 */
export const checkBlockingUserMiddleware = (userIdParamName = 'userId') => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const currentUserId = (req.context?.user as IUser)?._id
      if (!currentUserId) {
        return next(
          new AppError({
            message: 'Unauthorized',
            status: 401
          })
        )
      }

      // Lấy ID người dùng từ params hoặc body
      const targetUserId = req.params[userIdParamName] || req.body[userIdParamName]

      if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) {
        return next()
      }

      // Kiểm tra xem người dùng hiện tại có chặn người dùng khác không
      const currentUserSettings = await SettingsModel.findOne({ userId: currentUserId })

      if (
        currentUserSettings &&
        currentUserSettings.security.blockedUsers.some(
          (id) => id.toString() === targetUserId.toString()
        )
      ) {
        return next(
          new AppError({
            message: 'Bạn không thể thực hiện hành động này vì đã chặn người dùng này',
            status: 403,
            name: 'USER_BLOCKING_ERROR'
          })
        )
      }

      next()
    } catch (error) {
      next(error)
    }
  }
}
