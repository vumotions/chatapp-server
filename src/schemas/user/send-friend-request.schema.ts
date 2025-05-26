import z from 'zod'
import { AppError } from '~/models/error.model'
import userService from '~/services/user.service'

const rawSendFriendRequestSchema = z.object({
  id: z.string()
})

export const sendFriendRequestSchema = rawSendFriendRequestSchema.transform(async (data) => {
  const followedUser = await userService.getUserById(data.id)
  if (!followedUser) {
    throw new AppError({
      message: 'An error occurred. Please try resending the OTP',
      status: 400, // BAD_REQUEST
      name: 'RESET_PASSWORD_ERROR'
    })
  }

  return data
})

export type SendFriendRequestDTO = z.infer<typeof rawSendFriendRequestSchema>
