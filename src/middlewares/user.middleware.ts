import validate from '~/helpers/validation'
import { registerSchema } from '~/schemas/user.schemas'

export const registerValidator = validate({
  body: registerSchema
})
