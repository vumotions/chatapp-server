import { Router } from 'express'
import userController from '~/controllers/user.controller'
import { wrapRequestHandler } from '~/helpers/handler'
import { accessTokenValidator, verifiedUserValidator } from '~/middlewares/auth.middleware'
import {
  sendFriendRequestValidator,
  updateMyProfileValidator
} from '~/middlewares/user.middlewares'

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

// Get user by ID
userRoutes.get(
  '/:userId',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(userController.getUserById)
)

// Get user by username
userRoutes.get(
  '/profile/:username',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(userController.getUserByUsername)
)

export default userRoutes
