import { NextFunction, Request, Response } from 'express'
import { omit } from 'lodash'
import { USER_VERIFY_STATUS } from '~/constants/enums'
import { AppSuccess } from '~/models/success.model'
import { IUser } from '~/models/user.model'
import { ConfirmEmailOtpDTO } from '~/schemas/common.schema'
import { RegisterDTO } from '~/schemas/register.schema'
import { ResetPasswordDTO } from '~/schemas/reset-password.schema'
import userService from '~/services/user.service'
import { TokenPayload } from '~/types/payload.type'

class UsersController {
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
    await userService.confirmResetPassword(req.body)

    res.json(
      new AppSuccess({
        message: 'OTP verified successfully. You can now proceed to reset your password!',
        data: null
      })
    )
  }

  async resetPassword(req: Request<any, any, ResetPasswordDTO>, res: Response, next: NextFunction) {
    const { confirmPassword, ...data } = req.body
    await userService.resetPassword(data)

    res.json(
      new AppSuccess({
        message:
          'Your password has been reset successfully. You can now log in with your new password',
        data: null
      })
    )
  }
}

const userController = new UsersController()
export default userController
