import { differenceInHours, differenceInMinutes } from 'date-fns'
import { omit } from 'lodash'
import z, { ZodIssueCode } from 'zod'
import { USER_VERIFY_STATUS } from '~/constants/enums'
import { hashPassword } from '~/helpers/crypto'
import { AppError } from '~/models/error.model'
import { TransformContext } from '~/models/transform-context.model'
import UserModel from '~/models/User.model'

const rawLoginSchema = z.object({
  email: z.string().email({ message: 'Invalid email address' }),
  password: z.string().min(6, { message: 'Password must be at least 6 characters' })
})

export const loginSchema = rawLoginSchema.transform(async (data, ctx) => {
  const user = await UserModel.findOne({
    email: data.email,
    passwordHash: hashPassword(data.password)
  })

  if (!user) {
    return ctx.addIssue({
      message: 'Email or password is incorrect',
      code: ZodIssueCode.custom,
      path: ['email']
    })
  }

  if (user.emailLockedUntil) {
    const currentTime = new Date()
    const lockEndTime = user.emailLockedUntil

    if (currentTime < lockEndTime) {
      const remainingTime = differenceInMinutes(lockEndTime, currentTime)
      const remainingHours = differenceInHours(lockEndTime, currentTime)

      const remainingMessage =
        remainingHours >= 1 ? `${remainingHours} hours` : `${remainingTime} minutes`

      throw new AppError({
        message: `Your account is temporarily suspended. Please try again after ${remainingMessage}`,
        status: 403, // FORBIDDEN
        name: 'ACCOUNT_SUSPENDED_ERROR'
      })
    }
  }

  if (user.verify === USER_VERIFY_STATUS.UNVERIFIED) {
    throw new AppError({
      message:
        'Your account is not verified yet. Please check your inbox to complete the verification process',
      status: 403, // FORBIDDEN
      name: 'UNVERIFIED_ACCOUNT_ERROR'
    })
  }
  return new TransformContext({
    data,
    context: {
      user: omit(user.toObject(), ['passwordHash'])
    }
  })
})

export type LoginDTO = z.infer<typeof rawLoginSchema>
