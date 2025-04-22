import validate from '~/helpers/validation'
import { confirmEmailSchema } from '~/schemas/confirm-email.schema'
import { loginSchema } from '~/schemas/login.schemas'
import { registerSchema } from '~/schemas/register.schema'
import { requestEmailSchema } from '~/schemas/request-email.schema'

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
