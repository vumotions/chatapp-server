import { omit } from 'lodash'
import z from 'zod'
import { env } from '~/config/env'
import { AppError } from '~/models/error.model'
import { TransformContext } from '~/models/transform-context.model'
import jwtService from '~/services/jwt.service'
import userService from '~/services/user.service'

const rawAccessTokenSchema = z.object({
  authorization: z.string().optional()
})

export const accessTokenSchema = rawAccessTokenSchema.transform(async (data) => {
  try {
    const accessToken = data.authorization?.split(' ')[1]
    if (!accessToken?.trim()) {
      throw new AppError({
        message: 'Access token is invalid',
        status: 401,
        name: 'INVALID_ACCESS_TOKEN_ERROR'
      })
    }
    const decodedAccessToken = await jwtService.verifyToken({
      token: accessToken,
      secretOrPublicKey: env.JWT_ACCESS_TOKEN_PRIVATE_KEY
    })

    const user = await userService.getUserById(decodedAccessToken.userId)
    if (!user) {
      throw new AppError({
        message: 'User does not exist',
        status: 401,
        name: 'USER_NOT_FOUND'
      })
    }

    return new TransformContext({
      data,
      context: {
        decodedAccessToken,
        user: omit(user?.toObject(), ['passwordHash'])
      }
    })
  } catch (error) {
    throw new AppError({
      message: 'Invalid or expired refresh token',
      status: 401,
      name: 'ACCESS_TOKEN_EXPIRED_ERROR'
    })
  }
})

export type AccessTokenDTO = z.infer<typeof rawAccessTokenSchema>
