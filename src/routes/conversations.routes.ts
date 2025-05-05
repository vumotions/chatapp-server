import { Router } from 'express'
import conversationsController from '~/controllers/conversations.controller'
import { wrapRequestHandler } from '~/helpers/handler'

const conversationsRoutes = Router()

conversationsRoutes.get(
  '/messages',
  wrapRequestHandler(conversationsController.getUserConversations)
)

conversationsRoutes.get(
  '/messages/:chatId',
  wrapRequestHandler(conversationsController.getMessagesByConversation)
)

export default conversationsRoutes
