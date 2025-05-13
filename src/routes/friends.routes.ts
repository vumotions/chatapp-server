import { Router } from 'express'
import { accessTokenValidator, verifiedUserValidator } from '~/middlewares/auth.middleware'
import friendsController from '../controllers/friends.controller'

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

// Lấy danh sách bạn bè đã kết bạn (thêm hỗ trợ tìm kiếm)
friendsRoutes.get(
  '/',
  accessTokenValidator,
  verifiedUserValidator,
  friendsController.getFriendsList
)

// Xóa bạn bè
friendsRoutes.delete(
  '/remove/:friendId',
  accessTokenValidator,
  verifiedUserValidator,
  friendsController.removeFriend
)

// Lấy trạng thái kết bạn với một người dùng cụ thể
friendsRoutes.get(
  '/status/:friendId',
  accessTokenValidator,
  verifiedUserValidator,
  friendsController.getFriendStatus
)

// Lấy danh sách bạn bè
friendsRoutes.get('/list', accessTokenValidator, friendsController.getFriendsList)

// Thêm route tìm kiếm tất cả người dùng
friendsRoutes.get(
  '/search',
  accessTokenValidator,
  verifiedUserValidator,
  friendsController.searchUsers
)

export default friendsRoutes
