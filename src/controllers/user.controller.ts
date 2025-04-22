import { NextFunction, Request, Response } from 'express'
import { OTP_PURPOSE, USER_VERIFY_STATUS } from '~/constants/enums'
import { AppSuccess } from '~/models/success.model'
import UserModel, { IUser } from '~/models/user.model'
import { ConfirmEmailDTO } from '~/schemas/confirm-email.schema'
import { RegisterDTO } from '~/schemas/register.schema'
import otpService from '~/services/otp.service'
import userService from '~/services/user.service'

class UsersController {
  async register(req: Request<any, any, RegisterDTO>, res: Response, next: NextFunction) {
    const result = await userService.register(req.body)

    res.json(
      new AppSuccess({
        message: 'You have successfully registered. Please verify your email to complete the process.',
        data: result
      })
    )
  }

  async login(req: Request<any, any, any>, res: Response, next: NextFunction) {
    const user = req.context?.user
    res.json(
      new AppSuccess({
        message: 'You have successfully logged in!',
        data: user
      })
    )
  }

  async requestEmailVerification(req: Request, res: Response, next: NextFunction) {
    const user = req.context?.user as IUser
    await otpService.sendOTP({
      purpose: OTP_PURPOSE.EMAIL_VERIFICATION,
      user
    })

    res.json(
      new AppSuccess({
        message: 'Please check your email for the verification code',
        data: user
      })
    )
  }

  async confirmEmailVerification(req: Request<any, any, ConfirmEmailDTO>, res: Response, next: NextFunction) {
    const user = req.context?.user as IUser

    const updatedUser = await UserModel.findByIdAndUpdate(
      user._id,
      {
        verify: USER_VERIFY_STATUS.VERIFIED
      },
      { new: true }
    )

    res.json(
      new AppSuccess({
        message: 'Your email has been verified successfully',
        data: updatedUser
      })
    )
  }
}

const userController = new UsersController()
export default userController
