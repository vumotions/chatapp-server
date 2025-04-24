import validate from '~/helpers/validation'
import { confirmEmailSchema } from '~/schemas/confirm-email.schema'
import { confirmResetPasswordSchema } from '~/schemas/confirm-reset-password.schema'
import { loginSchema } from '~/schemas/login.schemas'
import { refreshTokenSchema } from '~/schemas/refresh-token.schema'
import { registerSchema } from '~/schemas/register.schema'
import { requestEmailSchema } from '~/schemas/request-email.schema'
import { requestResetPasswordSchema } from '~/schemas/request-reset-password.schema'
import { resetPasswordSchema } from '~/schemas/reset-password.schema'

export const registerValidator = validate({
  body: registerSchema
})

export const loginValidator = validate({
  body: loginSchema
})

export const requestEmailValidator = validate({
  body: requestEmailSchema
})

export const confirmEmailValidator = validate({
  body: confirmEmailSchema
})

export const refreshTokenValidator = validate({
  body: refreshTokenSchema
})

export const requestResetPasswordValidator = validate({
  body: requestResetPasswordSchema
})

export const confirmResetPasswordValidator = validate({
  body: confirmResetPasswordSchema
})

export const resetPasswordValidator = validate({
  body: resetPasswordSchema
})
