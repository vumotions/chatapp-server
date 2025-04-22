import status from 'http-status'
import z from 'zod'
import { USER_VERIFY_STATUS } from '~/constants/enums'
import { AppError } from '~/models/error.model'
import { TransformContext } from '~/models/transform-context.model'
import userService from '~/services/user.service'

const rawRequestEmailSchema = z.object({
  email: z.string().email({ message: 'Invalid email address' })
})

export const requestEmailSchema = rawRequestEmailSchema.transform(async (data) => {
  const user = await userService.getUserByEmail(data.email)
  if (!user) {
    throw new AppError({
      message: 'User not found',
      status: status.BAD_REQUEST
    })
  }

  if (user.verify === USER_VERIFY_STATUS.VERIFIED) {
    throw new AppError({
      message: 'Your email is already verified. You can now log in to your account',
      status: status.FORBIDDEN
    })
  }

  return new TransformContext({
    data,
    context: {
      user
    }
  })
})

export type RequestEmailDTO = z.infer<typeof rawRequestEmailSchema>
