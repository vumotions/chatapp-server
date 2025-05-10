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

// Đặt các route cụ thể trước các route có tham số
// Route cho archived chats - đặt TRƯỚC route /:conversationId
conversationsRoutes.get(
  '/archived',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.getArchivedChats)
)

// Các route khác với tham số động
conversationsRoutes.get(
  '/:conversationId',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.getConversationById)
)

conversationsRoutes.get(
  '/messages/:chatId',
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

// Thêm routes cho xóa và chỉnh sửa tin nhắn
conversationsRoutes.delete(
  '/messages/:messageId',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.deleteMessage)
)

conversationsRoutes.put(
  '/messages/:messageId',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.editMessage)
)

// Thêm route cho xóa cuộc trò chuyện
conversationsRoutes.delete(
  '/:conversationId',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.deleteConversation)
)

// Thêm route test socket
conversationsRoutes.post('/test-socket', accessTokenValidator, conversationsController.testSocket)

// Sửa lại route cho archived chats
conversationsRoutes.get(
  '/archived',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.getArchivedChats)
)

// Thêm route để archive/unarchive cuộc trò chuyện
conversationsRoutes.put(
  '/:conversationId/archive',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.archiveConversation)
)

conversationsRoutes.put(
  '/:conversationId/unarchive',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.unarchiveConversation)
)

// Thêm route để ghim/bỏ ghim tin nhắn
conversationsRoutes.put(
  '/messages/:messageId/pin',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.pinMessage)
)

// Thêm route để lấy tin nhắn đã ghim
conversationsRoutes.get(
  '/:chatId/pinned-messages',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.getPinnedMessages)
)

export default conversationsRoutes
