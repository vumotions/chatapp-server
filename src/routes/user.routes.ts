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

// Get my profile
userRoutes.patch(
  '/my-profile',
  accessTokenValidator,
  verifiedUserValidator,
  updateMyProfileValidator,
  wrapRequestHandler(userController.updateMyProfile)
)

// // Get friend list
// userRoutes.get(
//   '/:id/friends',
//   accessTokenValidator,
//   verifiedUserValidator,
//   wrapRequestHandler(userController.getMyProfile)
// )

// userRoutes.post(
//   '/:id/addfriend',
//   accessTokenValidator,
//   verifiedUserValidator,
//   sendFriendRequestValidator,
//   wrapRequestHandler(userController.getMyProfile)
// )

// userRoutes.post(
//   '/:id/unfriend',
//   accessTokenValidator,
//   verifiedUserValidator,
//   sendFriendRequestValidator,
//   wrapRequestHandler(userController.getMyProfile)
// )

// userRoutes.get(
//   '/:id/add-friend',
//   accessTokenValidator,
//   verifiedUserValidator,
//   sendFriendRequestValidator,
//   wrapRequestHandler(userController.getMyProfile)
// )

export default userRoutes
