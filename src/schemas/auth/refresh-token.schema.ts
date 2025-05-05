import status from 'http-status'
import z from 'zod'
import { env } from '~/config/env'
import { AppError } from '~/models/error.model'
import RefreshTokenModel from '~/models/refresh-token.model'
import { TransformContext } from '~/models/transform-context.model'
import jwtService from '~/services/jwt.service'

const rawRefreshTokenSchema = z.object({
  refreshToken: z.string().optional()
})

export const refreshTokenSchema = rawRefreshTokenSchema.transform(async (data) => {
  const { refreshToken } = data
  console.log('refreshtoken: ', refreshToken)
  if (!refreshToken) {
    throw new AppError({
      message: 'Refresh token is invalid',
      status: status.UNAUTHORIZED,
      name: 'INVALID_REFRESH_TOKEN_ERROR'
    })
  }

  try {
    const [decodedRefreshToken, foundRefreshToken] = await Promise.all([
      jwtService.verifyToken({
        token: refreshToken,
        secretOrPublicKey: env.JWT_REFRESH_TOKEN_PRIVATE_KEY
      }),
      RefreshTokenModel.findOne({
        token: refreshToken
      })
    ])

    if (!foundRefreshToken) {
      throw new AppError({
        message: 'Refresh token does not exist',
        status: status.UNAUTHORIZED
      })
    }

    return new TransformContext({
      data,
      context: {
        decodedRefreshToken
      }
    })
  } catch (error) {
    throw new AppError({
      message: 'Invalid or expired refresh token',
      status: status.UNAUTHORIZED,
      name: 'REFRESH_TOKEN_EXPIRED_ERROR'
    })
  }
})

export type RefreshTokenDTO = z.infer<typeof rawRefreshTokenSchema>
