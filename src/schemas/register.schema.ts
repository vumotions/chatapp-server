import z, { ZodIssueCode } from 'zod'
import { USER_VERIFY_STATUS } from '~/constants/enums'
import userService from '~/services/user.service'

export const registerSchema = z
  .object({
    name: z.string().min(3, { message: 'Name must be at least 3 characters' }),
    email: z.string().email({ message: 'Invalid email address' }),
    day: z.coerce
      .number({ invalid_type_error: 'Day must be a valid number' })
      .min(1, { message: 'Invalid day' })
      .max(31, { message: 'Invalid day' }),
    month: z.coerce
      .number({ invalid_type_error: 'Month must be a valid number' })
      .min(1, { message: 'Invalid month' })
      .max(12, { message: 'Invalid month' }),
    year: z.coerce
      .number({ invalid_type_error: 'Year must be a valid number' })
      .min(1900, { message: 'Invalid year' })
      .max(new Date().getFullYear(), { message: `Year must not be greater than the current year` }),
    gender: z.enum(['male', 'female', 'other'], { message: 'Invalid gender' }),
    password: z.string().min(6, { message: 'Password must be at least 6 characters' }),
    confirmPassword: z.string().min(6, { message: 'Confirm password must be at least 6 characters' })
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Password and confirm password do not match',
    path: ['confirmPassword']
  })
  .superRefine(async (data, ctx) => {
    const verify = await userService.getEmailVerificationStatus(data.email)

    if (verify && verify === USER_VERIFY_STATUS.VERIFIED) {
      ctx.addIssue({
        path: ['email'],
        message: 'Email address already taken. Please use a different one',
        code: ZodIssueCode.custom
      })
    }
    return z.NEVER
  })

export type RegisterDTO = z.infer<typeof registerSchema>
