import { NextFunction, Request, Response } from 'express'
import status from 'http-status'
import { omit } from 'lodash'
import { AppError } from '~/models/error.model'
import { AppSuccess } from '~/models/success.model'
import UserModel from '~/models/user.model'
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
        message: 'Your profile has been updated successfully',
        data: omit(updatedUser?.toObject(), ['passwordHash'])
      })
    )
  }

  // Add new method to get user by ID
  async getUserById(req: Request, res: Response, next: NextFunction) {
    const userId = req.params.userId

    try {
      const user = await UserModel.findById(userId)

      if (!user) {
        next(
          new AppError({
            status: status.NOT_FOUND,
            message: 'User not found'
          })
        )
        return
      }

      res.json(
        new AppSuccess({
          message: 'User found successfully',
          data: {
            _id: user._id,
            name: user.name,
            username: user.username,
            avatar: user.avatar,
            bio: user.bio
          }
        })
      )
    } catch (error) {
      next(error)
    }
  }
  
  // Add new method to get user by username
  async getUserByUsername(req: Request, res: Response, next: NextFunction) {
    const username = req.params.username

    try {
      const user = await userService.getUserByUsername(username)

      if (!user) {
        next(
          new AppError({
            status: status.NOT_FOUND,
            message: 'User not found'
          })
        )
        return
      }

      res.json(
        new AppSuccess({
          message: 'User found successfully',
          data: {
            _id: user._id,
            name: user.name,
            username: user.username,
            avatar: user.avatar,
            bio: user.bio,
            coverPhoto: user.coverPhoto
          }
        })
      )
    } catch (error) {
      next(error)
    }
  }
}

const userController = new UsersController()
export default userController
