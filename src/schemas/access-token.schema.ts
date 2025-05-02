import status from 'http-status'
import z from 'zod'
import { env } from '~/config/env'
import { AppError } from '~/models/error.model'
import { TransformContext } from '~/models/transform-context.model'
import jwtService from '~/services/jwt.service'

const rawAccessTokenSchema = z.object({
  authorization: z.string()
})

export const accessTokenSchema = rawAccessTokenSchema.transform(async (data) => {
  try {
    const accessToken = data.authorization.split(' ')[1]
    if (!accessToken.trim()) {
      throw new AppError({
        message: 'Access token is invalid',
        status: status.UNAUTHORIZED,
        name: 'INVALID_ACCESS_TOKEN_ERROR'
      })
    }
    const decodedAccessToken = await jwtService.verifyToken({
      token: accessToken,
      secretOrPublicKey: env.JWT_ACCESS_TOKEN_PRIVATE_KEY
    })

    return new TransformContext({
      data,
      context: {
        decodedAccessToken
      }
    })
  } catch (error) {
    throw new AppError({
      message: 'Invalid or expired refresh token',
      status: status.UNAUTHORIZED,
      name: 'ACCESS_TOKEN_EXPIRED_ERROR'
    })
  }
})

export type AccessTokenDTO = z.infer<typeof rawAccessTokenSchema>
