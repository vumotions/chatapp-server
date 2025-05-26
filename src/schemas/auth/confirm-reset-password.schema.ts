import { ZodIssueCode } from 'zod'
import otpService from '~/services/otp.service'
import userService from '~/services/user.service'
import { confirmEmailOtpSchema } from '../common.schema'
import { OTP_STATUS } from '~/constants/enums'
import { getOTPErrorMessage } from '~/helpers/common'
import { TransformContext } from '~/models/transform-context.model'

export const confirmResetPasswordSchema = confirmEmailOtpSchema.transform(async (data, ctx) => {
  const [otpStatus, user] = await Promise.all([
    otpService.verifyOTP(data as any),
    userService.getUserByEmail(data.email)
  ])

  if (!user) {
    return ctx.addIssue({
      code: ZodIssueCode.custom,
      message: 'This email has not been registered in our system',
      path: ['email']
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
