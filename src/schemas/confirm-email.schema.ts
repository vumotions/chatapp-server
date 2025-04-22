import status from 'http-status'
import z, { ZodIssueCode } from 'zod'
import { OTP_STATUS, USER_VERIFY_STATUS } from '~/constants/enums'
import { getOTPErrorMessage } from '~/helpers/common'
import { AppError } from '~/models/error.model'
import { TransformContext } from '~/models/transform-context.model'
import otpService from '~/services/otp.service'
import userService from '~/services/user.service'

const rawConfirmEmailSchema = z.object({
  email: z.string().email({ message: 'Invalid email address' }),
  otp: z
    .string()
    .regex(/^\d{6}$/, { message: 'OTP must be exactly 6 digits' })
    .transform((val) => parseInt(val, 10))
})

export const confirmEmailSchema = rawConfirmEmailSchema.transform(async (data, ctx) => {
  const [otpStatus, user] = await Promise.all([otpService.verifyOTP(data), userService.getUserByEmail(data.email)])
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

  if (otpStatus !== OTP_STATUS.VALID) {
    const message = getOTPErrorMessage(otpStatus)
    ctx.addIssue({
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

export type ConfirmEmailDTO = z.infer<typeof rawConfirmEmailSchema>
