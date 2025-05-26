import { Router } from 'express'
import userController from '~/controllers/user.controller'
import { wrapRequestHandler } from '~/helpers/handler'
import { accessTokenValidator, verifiedUserValidator } from '~/middlewares/auth.middleware'
import { updateMyProfileValidator, updateSettingsValidator } from '~/middlewares/user.middlewares'

const userRoutes = Router()

// Get my profile
userRoutes.get(
  '/my-profile',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(userController.getMyProfile)
)

// Update my profile
userRoutes.patch(
  '/my-profile',
  accessTokenValidator,
  verifiedUserValidator,
  updateMyProfileValidator,
  wrapRequestHandler(userController.updateMyProfile)
)

userRoutes.get(
  '/blocked-users',
  accessTokenValidator,
  verifiedUserValidator,
  userController.getBlockedUsers
)

// Get user by username
userRoutes.get(
  '/profile/:username',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(userController.getUserByUsername)
)

// Block/Unblock user
userRoutes.post('/block', accessTokenValidator, verifiedUserValidator, userController.blockUser)

userRoutes.post('/unblock', accessTokenValidator, verifiedUserValidator, userController.unblockUser)

// Kiểm tra xem người dùng hiện tại có bị chặn bởi người dùng khác không
userRoutes.get(
  '/is-blocked-by/:userId',
  accessTokenValidator,
  verifiedUserValidator,
  userController.isBlockedByUser
)

// Update settings
userRoutes.patch(
  '/settings',
  accessTokenValidator,
  verifiedUserValidator,
  updateSettingsValidator,
  wrapRequestHandler(userController.updateSettings)
)

// Get settings
userRoutes.get(
  '/settings',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(userController.getSettings)
)

// Get user by ID
userRoutes.get(
  '/:userId',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(userController.getUserById)
)

export default userRoutes
