import z from 'zod'
import { OTP_PURPOSE } from '~/constants/enums'
import { AppError } from '~/models/error.model'
import OTPModel from '~/models/otp.model'

const rawResetPasswordSchema = z
  .object({
    email: z.string().email({ message: 'Invalid email address' }),
    password: z.string().min(6, { message: 'Password must be at least 6 characters' }),
    confirmPassword: z
      .string()
      .min(6, { message: 'Confirm password must be at least 6 characters' })
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Password and confirm password do not match',
    path: ['confirmPassword']
  })

export const resetPasswordSchema = rawResetPasswordSchema.transform(async (data) => {
  const otpRecord = await OTPModel.findOne({
    email: data.email,
    purpose: OTP_PURPOSE.FORGOT_PASSWORD
  })

  if (!otpRecord || (otpRecord && !otpRecord.verify)) {
    throw new AppError({
      message: 'An error occurred. Please try resending the OTP',
      status: 400,
      name: 'RESET_PASSWORD_ERROR'
    })
  }

  return data
})

export type ResetPasswordDTO = z.infer<typeof rawResetPasswordSchema>
