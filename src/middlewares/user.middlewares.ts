import { NextFunction, Request, Response } from 'express'
import { ZodIssue, ZodIssueCode } from 'zod'
import validate from '~/helpers/validation'
import { UnprocessableEntityError } from '~/models/error.model'
import { IUser } from '~/models/User.model'
import { sendFriendRequestSchema } from '~/schemas/user/send-friend-request.schema'
import { updateMyProfileSchema } from '~/schemas/user/update-profile.schema'
import { updateSettingsSchema } from '~/schemas/user/update-settings.schema'
import userService from '~/services/user.service'

export const updateMyProfileValidator = async (req: Request, res: Response, next: NextFunction) => {
  const parseResult = updateMyProfileSchema.safeParse(req.body)

  if (!parseResult.success) {
    const zodErrors = parseResult.error.errors
    const formattedErrors: Record<string, ZodIssue> = {}

    for (const issue of zodErrors) {
      const key = issue.path[0] as string
      if (!formattedErrors[key]) {
        formattedErrors[key] = {
          code: ZodIssueCode.custom,
          message: issue.message,
          path: issue.path
        }
      }
    }

    return next(
      new UnprocessableEntityError({
        message: 'Validation failed',
        errors: formattedErrors
      })
    )
  }

  const data = parseResult.data
  const errors: Record<string, ZodIssue> = {}
  const currentUserId = req.context?.user?._id as string

  // Username validation
  if (data.username) {
    const existingUser = (await userService.getUserByUsername(data.username)) as IUser
    if (existingUser && String(existingUser?._id) !== String(currentUserId)) {
      errors.username = {
        code: ZodIssueCode.custom,
        message: 'Username already exists',
        path: ['username']
      }
    }
  }

  // Date of birth validation
  const { day, month, year } = data
  if (day && month && year) {
    const dob = new Date(year, month - 1, day)
    const isValidDOB =
      dob.getFullYear() === year && dob.getMonth() === month - 1 && dob.getDate() === day

    if (!isValidDOB) {
      errors.dob = {
        code: ZodIssueCode.custom,
        message: 'Invalid date of birth',
        path: ['dob']
      }
    } else {
      req.body.dateOfBirth = dob.toISOString()
    }
  }

  if (Object.keys(errors).length > 0) {
    next(
      new UnprocessableEntityError({
        message: 'Unprocessable Entity', // 422_NAME
        errors
      })
    )
  }
  next()
}

export const sendFriendRequestValidator = validate({
  params: sendFriendRequestSchema
})

export const updateSettingsValidator = validate({
  body: updateSettingsSchema
})
