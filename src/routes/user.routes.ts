import { Router } from 'express'
import userController from '~/controllers/user.controller'
import { wrapRequestHandler } from '~/helpers/handler'

import {
  confirmEmailValidator,
  loginValidator,
  registerValidator,
  requestEmailValidator
} from '~/middlewares/user.middleware'

const authRoutes = Router()

authRoutes.post('/register', registerValidator, wrapRequestHandler(userController.register))
authRoutes.post('/login', loginValidator, wrapRequestHandler(userController.login))
authRoutes.post(
  '/email/verify/request',
  requestEmailValidator,
  wrapRequestHandler(userController.requestEmailVerification)
)
authRoutes.post(
  '/email/verify/confirm',
  confirmEmailValidator,
  wrapRequestHandler(userController.confirmEmailVerification)
)
authRoutes.post(
  '/email/verify/resend',
  requestEmailValidator,
  wrapRequestHandler(userController.requestEmailVerification)
)

export default authRoutes
