import { Router } from 'express'
import conversationsController from '~/controllers/conversations.controller'
import { wrapRequestHandler } from '~/helpers/handler'
import { accessTokenValidator, verifiedUserValidator } from '~/middlewares/auth.middleware'

const conversationsRoutes = Router()

conversationsRoutes.get(
  '/',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.getUserConversations)
)

conversationsRoutes.get(
  '/messages/:chatId',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.getMessagesByConversation)
)

conversationsRoutes.get(
  '/messages',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.getMessagesByConversation)
)

conversationsRoutes.post(
  '/conversations',
  accessTokenValidator,
  verifiedUserValidator,
  conversationsController.createConversation
)

conversationsRoutes.patch(
  '/:chatId/read',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.markChatAsRead)
)

export default conversationsRoutes
