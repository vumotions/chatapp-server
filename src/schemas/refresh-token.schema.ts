import status from 'http-status'
import z from 'zod'
import { env } from '~/config/env'
import { AppError } from '~/models/error.model'
import RefreshTokenModel from '~/models/refresh-token.model'
import { TransformContext } from '~/models/transform-context.model'
import jwtService from '~/services/jwt.service'

const rawRefreshTokenSchema = z.object({
  refreshToken: z.string()
})

export const refreshTokenSchema = rawRefreshTokenSchema.transform(async (data, ctx) => {
  const { refreshToken } = data
  if (!refreshToken) {
    throw new AppError({
      message: 'Refresh token is required',
      status: status.UNAUTHORIZED
    })
  }

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
})

export type RefreshTokenDTO = z.infer<typeof rawRefreshTokenSchema>
