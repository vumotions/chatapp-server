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

// Tạo nhóm chat mới
conversationsRoutes.post(
  '/group',
  accessTokenValidator,
  verifiedUserValidator,
  conversationsController.createGroupConversation
)

// Tạo và quản lý link mời
conversationsRoutes.post(
  '/group/:conversationId/invite-link',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.generateInviteLink)
)

conversationsRoutes.get(
  '/group/join/:inviteLink',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.getGroupByInviteLink)
)

conversationsRoutes.post(
  '/group/join/:inviteLink',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.joinGroupByInviteLink)
)

// Quản lý yêu cầu tham gia
conversationsRoutes.get(
  '/group/:conversationId/join-requests',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.getJoinRequests)
)

conversationsRoutes.post(
  '/group/:conversationId/approve-request/:userId',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.approveJoinRequest)
)

conversationsRoutes.post(
  '/group/:conversationId/reject-request/:userId',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.rejectJoinRequest)
)

// Xóa thành viên khỏi nhóm
conversationsRoutes.delete(
  '/group/:conversationId/members/:userId',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.removeGroupMember)
)

// Thêm thành viên vào nhóm
conversationsRoutes.post(
  '/group/:conversationId/members',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.addGroupMembers)
)

// Thêm route cho rời nhóm
conversationsRoutes.post(
  '/group/:conversationId/leave',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.leaveGroupConversation)
)

// Thêm route cho xóa nhóm (chỉ admin)
conversationsRoutes.delete(
  '/group/:conversationId',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.deleteGroupConversation)
)

// Thêm route để kiểm tra quyền truy cập vào chat
conversationsRoutes.get(
  '/access/:conversationId',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.checkChatAccess)
)

// Thêm route cho chuyển quyền chủ nhóm
conversationsRoutes.post(
  '/group/:conversationId/transfer-ownership',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.transferOwnership)
)

// Thêm route để cập nhật vai trò thành viên
conversationsRoutes.put(
  '/group/:conversationId/members/role',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.updateGroupMemberRole)
)

// Thêm route cho giải tán nhóm (chỉ owner)
conversationsRoutes.delete(
  '/group/:conversationId/disband',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.disbandGroup)
)

// Thêm route để cập nhật thông tin nhóm
conversationsRoutes.put(
  '/group/:conversationId',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.updateGroupConversation)
)

// Thêm route để kiểm tra trạng thái yêu cầu tham gia
conversationsRoutes.get(
  '/group/:conversationId/join-request-status',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.checkJoinRequestStatus)
)

// Cấm chat thành viên trong nhóm
conversationsRoutes.post(
  '/group/:conversationId/members/:userId/mute',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.muteGroupMember)
)

// Bỏ cấm chat thành viên trong nhóm
conversationsRoutes.post(
  '/group/:conversationId/members/:userId/unmute',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.unmuteGroupMember)
)

// Kiểm tra trạng thái cấm chat của người dùng
conversationsRoutes.get(
  '/chat/:chatId/mute-status',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.checkUserMuteStatus)
)

// Thêm route để xóa tất cả yêu cầu tham gia
conversationsRoutes.delete(
  '/group/:conversationId/join-requests',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.deleteAllJoinRequests)
)

// Cập nhật cài đặt "Chỉ owner và admin được gửi tin nhắn"
conversationsRoutes.post(
  '/group/:conversationId/restrict-sending',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.updateSendMessageRestriction)
)

// Thêm route kiểm tra quyền gửi tin nhắn nếu chưa có
conversationsRoutes.get(
  '/:chatId/send-permission',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.checkSendMessagePermission)
)

// Thêm route để xóa lịch sử chat
conversationsRoutes.delete(
  '/:conversationId/clear-history',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(conversationsController.clearChatHistory)
)

export default conversationsRoutes
