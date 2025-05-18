import { Router } from 'express'
import postController from '~/controllers/post.controller'
import uploadMiddleware from '~/middlewares/upload.middleware'
import { accessTokenValidator, verifiedUserValidator } from '~/middlewares/auth.middleware'
import { wrapRequestHandler } from '~/helpers/handler'

const postsRoutes = Router()

// Create a new post
postsRoutes.post(
  '/create-post',
  uploadMiddleware,
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(postController.uploadeAPost)
)

// Get posts with filters
postsRoutes.get(
  '/get-posts',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(postController.getPost)
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

export default postsRoutes
