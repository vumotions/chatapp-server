import { Socket } from 'socket.io'
import { MEMBER_ROLE } from '~/constants/enums'
import SOCKET_EVENTS from '~/constants/socket-events'
import ChatModel from '~/models/chat.model'
import SettingsModel from '~/models/settings.model'

/**
 * Kiểm tra xem người dùng có bị muted trong nhóm không
 * @param socket Socket instance
 * @param chatId ID của cuộc trò chuyện
 * @returns {Promise<boolean>} true nếu người dùng có thể gửi tin nhắn, false nếu không
 */
export const checkUserCanSendMessage = async (socket: Socket, chatId: string): Promise<boolean> => {
  try {
    const userId = socket.handshake.auth.decodedAccessToken.userId

    // Nếu không có chatId (đang tạo chat mới), cho phép gửi tin nhắn
    if (!chatId) {
      return true
    }

    // Tìm cuộc trò chuyện
    const chat = await ChatModel.findById(chatId)
    if (!chat) {
      socket.emit(SOCKET_EVENTS.ERROR, { message: 'Không tìm thấy cuộc trò chuyện' })
      return false
    }

    // Kiểm tra người dùng có trong cuộc trò chuyện không
    const isMember = chat.participants.some((p) => p.toString() === userId.toString())
    if (!isMember) {
      socket.emit(SOCKET_EVENTS.ERROR, {
        message: 'Bạn không phải là thành viên của cuộc trò chuyện này'
      })
      return false
    }

    // Nếu là chat private, cho phép gửi tin nhắn ngay
    if (chat.type === 'PRIVATE') {
      return true
    }

    // Tìm thông tin thành viên (chỉ cần cho chat nhóm)
    const member = chat.members?.find((m) => m.userId.toString() === userId.toString())
    if (!member) {
      socket.emit(SOCKET_EVENTS.ERROR, { message: 'Không tìm thấy thông tin thành viên' })
      return false
    }

    // Kiểm tra nếu người dùng bị cấm chat
    if (member.isMuted) {
      // Kiểm tra thời hạn cấm chat
      if (!member.mutedUntil || new Date() < new Date(member.mutedUntil)) {
        const mutedUntilText = member.mutedUntil
          ? `đến ${new Date(member.mutedUntil).toLocaleString('vi-VN')}`
          : 'vô thời hạn'

        socket.emit(SOCKET_EVENTS.ERROR, { message: `Bạn đã bị cấm chat ${mutedUntilText}` })
        return false
      } else {
        // Đã hết thời hạn cấm chat, tự động bỏ cấm
        await ChatModel.updateOne(
          { _id: chatId, 'members.userId': userId },
          { $set: { 'members.$.isMuted': false, 'members.$.mutedUntil': null } }
        )
      }
    }

    // Kiểm tra chế độ "Chỉ owner và admin được gửi tin nhắn" (chỉ áp dụng cho chat nhóm)
    if (chat.onlyAdminsCanSend) {
      const isOwnerOrAdmin = member.role === MEMBER_ROLE.OWNER || member.role === MEMBER_ROLE.ADMIN

      // Nếu không phải owner hoặc admin
      if (!isOwnerOrAdmin) {
        // Kiểm tra thời hạn giới hạn
        if (!chat.restrictUntil || new Date() < new Date(chat.restrictUntil)) {
          const restrictUntilText = chat.restrictUntil
            ? `đến ${new Date(chat.restrictUntil).toLocaleString('vi-VN')}`
            : 'cho đến khi có thay đổi'

          socket.emit(SOCKET_EVENTS.ERROR, {
            message: `Chỉ quản trị viên mới có thể gửi tin nhắn ${restrictUntilText}`
          })
          return false
        } else {
          // Đã hết thời hạn, tự động tắt chế độ
          await ChatModel.findByIdAndUpdate(chatId, {
            onlyAdminsCanSend: false,
            restrictUntil: null
          })
        }
      }
    }

    console.log(`User ${userId} can send message to chat ${chatId}`)
    // Nếu không có vấn đề gì, cho phép gửi tin nhắn
    return true
  } catch (error) {
    console.error('Error checking user can send message:', error)
    socket.emit(SOCKET_EVENTS.ERROR, { message: 'Có lỗi xảy ra khi kiểm tra quyền gửi tin nhắn' })
    return false
  }
}
