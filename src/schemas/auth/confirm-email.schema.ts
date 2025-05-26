import { ZodIssueCode } from 'zod'
import { OTP_STATUS, USER_VERIFY_STATUS } from '~/constants/enums'
import { getOTPErrorMessage } from '~/helpers/common'
import { AppError } from '~/models/error.model'
import { TransformContext } from '~/models/transform-context.model'
import otpService from '~/services/otp.service'
import userService from '~/services/user.service'
import { confirmEmailOtpSchema } from '../common.schema'

export const confirmEmailSchema = confirmEmailOtpSchema.transform(async (data, ctx) => {
  const [otpStatus, user] = await Promise.all([
    otpService.verifyOTP(data as any),
    userService.getUserByEmail(data.email)
  ])
  if (!user) {
    throw new AppError({
      message: 'User not found',
      status: 400 // BAD_REQUEST
    })
  }

  if (user.verify === USER_VERIFY_STATUS.VERIFIED) {
    throw new AppError({
      message: 'Your email is already verified. You can now log in to your account',
      status: 403 // FORBIDDEN
    })
  }

  if (otpStatus !== OTP_STATUS.VALID) {
    const message = getOTPErrorMessage(otpStatus)
    return ctx.addIssue({
      code: ZodIssueCode.custom,
      path: ['otp'],
      message
    })
  }

  return new TransformContext({
    data,
    context: {
      user
    }
  })
})
