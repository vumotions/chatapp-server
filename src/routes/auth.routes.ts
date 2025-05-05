import { Router } from 'express'
import authController from '~/controllers/auth.controller'
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
} from '~/middlewares/auth.middleware'

const authRoutes = Router()

authRoutes.post('/register', registerValidator, wrapRequestHandler(authController.register))

authRoutes.post('/login', loginValidator, wrapRequestHandler(authController.login))

authRoutes.post('/oauth-login', wrapRequestHandler(authController.loginOauth))

authRoutes.post('/logout', wrapRequestHandler(authController.logout))

authRoutes.post(
  '/refresh-token',
  refreshTokenValidator,
  wrapRequestHandler(authController.refreshToken)
)

authRoutes.post(
  '/email/verify/request',
  requestEmailValidator,
  wrapRequestHandler(authController.requestEmailVerification)
)

authRoutes.post(
  '/email/verify/confirm',
  confirmEmailValidator,
  wrapRequestHandler(authController.confirmEmailVerification)
)

authRoutes.post(
  '/request-reset-password',
  requestResetPasswordValidator,
  wrapRequestHandler(authController.requestResetPassword)
)

authRoutes.post(
  '/confirm-reset-password',
  confirmResetPasswordValidator,
  wrapRequestHandler(authController.confirmResetPassword)
)

authRoutes.patch(
  '/reset-password',
  resetPasswordValidator,
  wrapRequestHandler(authController.resetPassword)
)

export default authRoutes
