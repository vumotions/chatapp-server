import userService from '~/services/user.service'
import { requestEmailOtpSchema } from '../common.schema'
import { ZodIssueCode } from 'zod'
import { TransformContext } from '~/models/transform-context.model'

export const requestResetPasswordSchema = requestEmailOtpSchema.transform(async (data, ctx) => {
  const user = await userService.getUserByEmail(data.email)

  if (!user) {
    return ctx.addIssue({
      code: ZodIssueCode.custom,
      message: 'This email has not been registered in our system',
      path: ['email']
    })
  }

  return new TransformContext({
    data,
    context: {
      user
    }
  })
})
