import { NextFunction, Request, Response } from 'express'
import { omit } from 'lodash'
import { AppSuccess } from '~/models/success.model'
import { UpdateMyProfileDTO } from '~/schemas/user/update-profile.schema'
import userService from '~/services/user.service'

class UsersController {
  getMyProfile(req: Request, res: Response, next: NextFunction) {
    res.json(
      new AppSuccess({
        message: 'Get profile successfully',
        data: req.context?.user
      })
    )
  }

  async updateMyProfile(
    req: Request<any, any, UpdateMyProfileDTO>,
    res: Response,
    next: NextFunction
  ) {
    const user = req.context?.user
    const updatedUser = await userService.updateProfile({
      userId: user?._id as string,
      body: req.body
    })

    res.json(
      new AppSuccess({
        message: 'Your email has been verified successfully',
        data: omit(updatedUser?.toObject(), ['passwordHash'])
      })
    )
  }

  getFriendList(req: Request, res: Response, next: NextFunction) {
    res.json(
      new AppSuccess({
        message: 'Get profile successfully',
        data: req.context?.user
      })
    )
  }

  sendFriendRequest(req: Request, res: Response, next: NextFunction) {
    const userId = req.params?.id as string
  }
}

const userController = new UsersController()
export default userController
