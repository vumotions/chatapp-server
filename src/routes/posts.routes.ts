import { Router } from 'express'
import postController from '~/controllers/post.controller'
import uploadMiddleware from '~/middlewares/upload.middleware'
import { accessTokenValidator, verifiedUserValidator } from '~/middlewares/auth.middleware'
import { wrapRequestHandler } from '~/helpers/handler'

const postsRoutes = Router()

// Đảm bảo route này được cấu hình đúng
postsRoutes.get(
  '/get-posts',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(postController.getPost)
)

// Create a new post
postsRoutes.post(
  '/create-post',
  uploadMiddleware,
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(postController.uploadeAPost)
)

// Like a post
postsRoutes.post(
  '/like',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(postController.likePost)
)

// Unlike a post
postsRoutes.delete(
  '/like/:postId',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(postController.deleteLikePost)
)

// Get comments for a post
postsRoutes.get(
  '/comments',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(postController.getPostComments)
)

// Create a comment
postsRoutes.post(
  '/comments',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(postController.createComment)
)

// Thêm routes cho like/unlike comment
postsRoutes.post(
  '/comments/like',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(postController.likeComment)
)

postsRoutes.delete(
  '/comments/like/:commentId',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(postController.unlikeComment)
)

// Thêm route cho chức năng chia sẻ bài viết
postsRoutes.post(
  '/share',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(postController.sharePost)
)

// Thêm route để lấy bài viết của người dùng theo userId
postsRoutes.get(
  '/user/:userId',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(postController.getUserPosts)
)

export default postsRoutes
