import { NextFunction, Request, Response } from 'express'
import { omit } from 'lodash'
import { USER_VERIFY_STATUS } from '~/constants/enums'
import { AppError } from '~/models/error.model'
import { AppSuccess } from '~/models/success.model'
import { IUser } from '~/models/User.model'
import { RefreshTokenDTO } from '~/schemas/auth/refresh-token.schema'
import { RegisterDTO } from '~/schemas/auth/register.schema'
import { ResetPasswordDTO } from '~/schemas/auth/reset-password.schema'
import { ConfirmEmailOtpDTO } from '~/schemas/common.schema'
import userService from '~/services/user.service'
import { TokenPayload } from '~/types/payload.type'

class AuthController {
  async register(req: Request<any, any, RegisterDTO>, res: Response, next: NextFunction) {
    const result = await userService.register(req.body)

    res.json(
      new AppSuccess({
        message:
          'You have successfully registered. Please verify your email to complete the process.',
        data: result
      })
    )
  }

  async login(req: Request, res: Response, next: NextFunction) {
    const user = req.context?.user as IUser
    const result = await userService.login({
      userId: String(user._id),
      verify: user.verify as USER_VERIFY_STATUS
    })

    res.json(
      new AppSuccess({
        message: 'You have successfully logged in!',
        data: {
          user,
          tokens: result
        }
      })
    )
  }

  async loginOauth(
    req: Request<
      any,
      any,
      {
        provider: string
        providerId: string
        email: string
        name: string
        avatar: string
      }
    >,
    res: Response,
    next: NextFunction
  ) {
    const { email, provider, providerId } = req.body

    if (!email || !provider || !providerId) {
      next(
        new AppError({
          message: 'Missing required fields',
          status: 404
        })
      )
    }

    const data = await userService.loginOauth(req.body)

    res.json(
      new AppSuccess({
        message: 'Login with google successfully',
        data: { user: data.user, tokens: data.tokens }
      })
    )
  }

  async logout(req: Request<any, any, RefreshTokenDTO>, res: Response, next: NextFunction) {
    const refreshToken = req.body?.refreshToken as string
    await userService.logout({
      refreshToken
    })

    res.json(
      new AppSuccess({
        message: 'Logout successfully',
        data: null
      })
    )
  }

  async refreshToken(req: Request, res: Response, next: NextFunction) {
    const decodedRefreshToken = req.context?.decodedRefreshToken as TokenPayload
    const { userId, verify } = decodedRefreshToken
    const tokens = await userService.signAccessAndRefreshTokens({
      userId,
      verify
    })

    res.json(
      new AppSuccess({
        message: 'Refresh token successfully',
        data: {
          tokens
        }
      })
    )
  }

  async requestEmailVerification(req: Request, res: Response, next: NextFunction) {
    const user = req.context?.user as IUser
    const otpRecord = await userService.requestEmailVerification(user)

    res.json(
      new AppSuccess({
        message: 'Please check your email for the verification code',
        data: {
          otpExpiresAt: otpRecord.expiresAt
        }
      })
    )
  }

  async confirmEmailVerification(req: Request, res: Response, next: NextFunction) {
    const user = req.context?.user as IUser
    const updatedUser = await userService.confirmEmailVerification(String(user._id))

    res.json(
      new AppSuccess({
        message: 'Your email has been verified successfully',
        data: omit(updatedUser?.toObject(), ['passwordHash'])
      })
    )
  }

  async requestResetPassword(req: Request, res: Response, next: NextFunction) {
    const user = req.context?.user as IUser
    const otpRecord = await userService.requestResetPassword(user)

    res.json(
      new AppSuccess({
        message: 'A password reset OTP has been sent to your email',
        data: {
          otpExpiresAt: otpRecord.expiresAt
        }
      })
    )
  }

  async confirmResetPassword(
    req: Request<any, any, ConfirmEmailOtpDTO>,
    res: Response,
    next: NextFunction
  ) {
    await userService.confirmResetPassword(req.body as any)

    res.json(
      new AppSuccess({
        message: 'OTP verified successfully. You can now proceed to reset your password!',
        data: null
      })
    )
  }

  async resetPassword(req: Request<any, any, ResetPasswordDTO>, res: Response, next: NextFunction) {
    const { confirmPassword, ...data } = req.body
    await userService.resetPassword(data as any)

    res.json(
      new AppSuccess({
        message:
          'Your password has been reset successfully. You can now log in with your new password',
        data: null
      })
    )
  }
}

const authController = new AuthController()
export default authController
