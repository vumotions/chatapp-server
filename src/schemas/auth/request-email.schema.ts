import { USER_VERIFY_STATUS } from '~/constants/enums'
import { AppError } from '~/models/error.model'
import { TransformContext } from '~/models/transform-context.model'
import userService from '~/services/user.service'
import { requestEmailOtpSchema } from '../common.schema'

export const requestEmailSchema = requestEmailOtpSchema.transform(async (data) => {
  const user = await userService.getUserByEmail(data.email)
  if (!user) {
    throw new AppError({
      message: 'User not found',
      status: 400 // BAD_REQUEST
    })
  }

  if (user.verify === USER_VERIFY_STATUS.VERIFIED) {
    throw new AppError({
      message: 'Your email is already verified. You can now log in to your account',
      status: 403, // FORBIDDEN
      name: 'ALREADY_VERIFIED_ACCOUNT_ERROR'
    })
  }

  return new TransformContext({
    data,
    context: {
      user
    }
  })
})
