import { Router } from 'express'
import searchController from '~/controllers/search.controller'
import { accessTokenValidator } from '~/middlewares/auth.middleware'


const searchRoutes = Router()

// Tìm kiếm tất cả (người dùng, bài viết, cuộc trò chuyện)
searchRoutes.get('/', accessTokenValidator, searchController.searchAll)

// Tìm kiếm người dùng
searchRoutes.get('/users', accessTokenValidator, searchController.searchUsers)

// Tìm kiếm bài viết
searchRoutes.get('/posts', accessTokenValidator, searchController.searchPosts)

// Tìm kiếm cuộc trò chuyện
searchRoutes.get('/conversations', accessTokenValidator, searchController.searchConversations)

export default searchRoutes
