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
  '/:id/comments',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(postController.getComments)
)

// Create a comment
postsRoutes.post(
  '/comments',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(postController.createComment)
)
// Update a comment
postsRoutes.patch(
  '/comments/:id',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(postController.updateComment)
)

// Delete a comment
postsRoutes.delete(
  '/comments/:id',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(postController.deleteComment)
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

// Get post by ID
postsRoutes.get(
  '/:postId',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(postController.getPostById)
)

// Delete a post
postsRoutes.delete(
  '/:postId',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(postController.deletePost)
)

export default postsRoutes
