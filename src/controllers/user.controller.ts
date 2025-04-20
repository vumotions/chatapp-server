import { NextFunction, Request, Response } from 'express'
import { AppSuccess } from '~/models/success.model'
import { RegisterDTO } from '~/schemas/user.schemas'
import userService from '~/services/user.service'

class UsersController {
  async register(req: Request<any, any, RegisterDTO>, res: Response, next: NextFunction) {
    const result = await userService.register(req.body)
    const response = new AppSuccess({
      message: 'User registered. Please verify your email.',
      data: result
    })
    res.status(response.status).json(response)
  }

  async login() {}
}

const userController = new UsersController()
export default userController
