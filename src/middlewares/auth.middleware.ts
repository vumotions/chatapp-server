import { NextFunction, Request, Response } from 'express'
import { USER_VERIFY_STATUS } from '~/constants/enums'
import validate from '~/helpers/validation'
import { AppError } from '~/models/error.model'
import { accessTokenSchema } from '~/schemas/auth/access-token.schema'
import { confirmEmailSchema } from '~/schemas/auth/confirm-email.schema'
import { confirmResetPasswordSchema } from '~/schemas/auth/confirm-reset-password.schema'
import { loginSchema } from '~/schemas/auth/login.schemas'
import { refreshTokenSchema } from '~/schemas/auth/refresh-token.schema'
import { registerSchema } from '~/schemas/auth/register.schema'
import { requestEmailSchema } from '~/schemas/auth/request-email.schema'
import { requestResetPasswordSchema } from '~/schemas/auth/request-reset-password.schema'
import { resetPasswordSchema } from '~/schemas/auth/reset-password.schema'
import { TokenPayload } from '~/types/payload.type'

export const registerValidator = validate({
  body: registerSchema
})

export const loginValidator = validate({
  body: loginSchema
})

export const accessTokenValidator = validate({
  headers: accessTokenSchema
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

export const verifiedUserValidator = async (req: Request, res: Response, next: NextFunction) => {
  const decodedAccessToken = req.context?.decodedAccessToken as TokenPayload
  if (decodedAccessToken.verify !== USER_VERIFY_STATUS.VERIFIED) {
    return next(
      new AppError({
        message:
          'Your account is not verified yet. Please check your inbox to complete the verification process',
        status: 403,
        name: 'UNVERIFIED_ACCOUNT_ERROR'
      })
    )
  }
  next()
}
