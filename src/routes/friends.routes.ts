import { Router } from 'express'
import friendsController from '../controllers/friends.controller'
import { accessTokenValidator, verifiedUserValidator } from '~/middlewares/auth.middleware'

const friendsRoutes = Router()

// Lấy danh sách gợi ý bạn bè (chưa kết bạn)
friendsRoutes.get(
  '/suggestions',
  accessTokenValidator,
  verifiedUserValidator,
  friendsController.getFriendSuggestions
)

// Gửi lời mời kết bạn
friendsRoutes.post('/add', accessTokenValidator, verifiedUserValidator, friendsController.addFriend)

// Chấp nhận lời mời kết bạn
friendsRoutes.post(
  '/accept',
  accessTokenValidator,
  verifiedUserValidator,
  friendsController.acceptFriendRequest
)

// Từ chối lời mời kết bạn
friendsRoutes.post(
  '/reject',
  accessTokenValidator,
  verifiedUserValidator,
  friendsController.rejectFriendRequest
)

// Hủy lời mời kết bạn
friendsRoutes.post(
  '/cancel',
  accessTokenValidator,
  verifiedUserValidator,
  friendsController.cancelFriendRequest
)

// Lấy danh sách bạn bè đã kết bạn
friendsRoutes.get(
  '/',
  accessTokenValidator,
  verifiedUserValidator,
  friendsController.getFriendsList
)

export default friendsRoutes
