import { Router } from 'express'
import userController from '~/controllers/user.controller'
import { wrapRequestHandler } from '~/helpers/handler'

import {
  confirmEmailValidator,
  confirmResetPasswordValidator,
  loginValidator,
  refreshTokenValidator,
  registerValidator,
  requestEmailValidator,
  requestResetPasswordValidator,
  resetPasswordValidator
} from '~/middlewares/user.middleware'

const authRoutes = Router()

authRoutes.post('/register', registerValidator, wrapRequestHandler(userController.register))

authRoutes.post('/login', loginValidator, wrapRequestHandler(userController.login))

authRoutes.post(
  '/refresh-token',
  refreshTokenValidator,
  wrapRequestHandler(userController.refreshToken)
)

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

authRoutes.post(
  '/request-reset-password',
  requestResetPasswordValidator,
  wrapRequestHandler(userController.requestResetPassword)
)

authRoutes.post(
  '/resend-request-reset-password',
  requestResetPasswordValidator,
  wrapRequestHandler(userController.requestResetPassword)
)

authRoutes.post(
  '/confirm-reset-password',
  confirmResetPasswordValidator,
  wrapRequestHandler(userController.confirmResetPassword)
)

authRoutes.patch(
  '/reset-password',
  resetPasswordValidator,
  wrapRequestHandler(userController.resetPassword)
)

export default authRoutes
