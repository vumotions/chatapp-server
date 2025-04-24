import z from 'zod'

export const requestEmailOtpSchema = z.object({
  email: z.string().email({ message: 'Invalid email address' })
})

export type RequestEmailOtpDTO = z.infer<typeof requestEmailOtpSchema>

export const confirmEmailOtpSchema = z.object({
  email: z.string().email({ message: 'Invalid email address' }),
  otp: z.string().regex(/^\d{6}$/, { message: 'OTP must be exactly 6 digits' })
})

export type ConfirmEmailOtpDTO = z.infer<typeof confirmEmailOtpSchema>
