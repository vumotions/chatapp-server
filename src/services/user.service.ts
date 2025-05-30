import { omit, pick } from 'lodash'
import mongoose from 'mongoose'
import { env } from '~/config/env'
import { OTP_PURPOSE, TOKEN_TYPE, USER_VERIFY_STATUS } from '~/constants/enums'
import { generateUsername } from '~/helpers/common'
import { hashPassword } from '~/helpers/crypto'
import OTPModel from '~/models/otp.model'
import RefreshTokenModel from '~/models/refresh-token.model'
import SettingsModel from '~/models/settings.model'
import UserModel, { IUser } from '~/models/User.model'
import { RegisterDTO } from '~/schemas/auth/register.schema'
import { UpdateMyProfileDTO } from '~/schemas/user/update-profile.schema'
import { UserIdentity } from '~/types/common.type'
import jwtService from './jwt.service'
import otpService from './otp.service'

class UserService {
  async signAccessToken({ userId, verify }: UserIdentity) {
    return jwtService.signToken({
      payload: {
        userId,
        tokenType: TOKEN_TYPE.ACCESS_TOKEN,
        verify
      },
      privateKey: env.JWT_ACCESS_TOKEN_PRIVATE_KEY,
      options: {
        expiresIn: env.JWT_ACCESS_TOKEN_EXPIRES_IN as any
      }
    })
  }

  async signRefreshToken({ userId, verify }: UserIdentity) {
    return jwtService.signToken({
      payload: {
        userId,
        tokenType: TOKEN_TYPE.REFRESH_TOKEN,
        verify
      },
      privateKey: env.JWT_REFRESH_TOKEN_PRIVATE_KEY,
      options: {
        expiresIn: env.JWT_REFRESH_TOKEN_EXPIRES_IN as any
      }
    })
  }

  async signAccessAndRefreshTokens(payload: UserIdentity) {
    const [accessToken, refreshToken] = await Promise.all([
      this.signAccessToken(payload),
      this.signRefreshToken(payload)
    ])
    return { accessToken, refreshToken }
  }

  async refreshToken({ refreshToken, ...identity }: { refreshToken: string } & UserIdentity) {
    const [tokens] = await Promise.all([
      this.signAccessAndRefreshTokens(identity),
      RefreshTokenModel.deleteOne({
        token: refreshToken
      })
    ])

    await RefreshTokenModel.create({
      userId: identity.userId,
      token: tokens.refreshToken
    })

    const accessTokenExpiresAt = await this.getAccessTokenExpiry(tokens.accessToken)
    return { ...tokens, accessTokenExpiresAt }
  }

  async getAccessTokenExpiry(token: string) {
    const { exp } = await jwtService.verifyToken({
      token,
      secretOrPublicKey: env.JWT_ACCESS_TOKEN_PRIVATE_KEY
    })
    return exp
  }

  async login(payload: UserIdentity) {
    const { accessToken, refreshToken } = await this.signAccessAndRefreshTokens(payload)

    await RefreshTokenModel.create({
      userId: payload.userId,
      token: refreshToken
    })

    const accessTokenExpiresAt = await this.getAccessTokenExpiry(accessToken)

    return { accessToken, refreshToken, accessTokenExpiresAt }
  }

  async loginOauth(body: {
    provider: string
    providerId: string
    email: string
    name: string
    avatar: string
  }) {
    const { avatar, email, name, provider, providerId } = body
    let user = await UserModel.findOne({ provider, providerId })
    if (!user) {
      const userId = new mongoose.Types.ObjectId()

      ;[user] = await Promise.all([
        UserModel.create({
          _id: userId,
          provider,
          providerId,
          username: generateUsername(name),
          name,
          email,
          avatar,
          verify: USER_VERIFY_STATUS.VERIFIED
        }),
        SettingsModel.create({ userId })
      ])
    }
    const tokens = await this.login({
      userId: user._id as string,
      verify: user.verify
    })

    const accessTokenExpiresAt = await this.getAccessTokenExpiry(tokens.accessToken)
    return {
      user,
      tokens: {
        ...tokens,
        accessTokenExpiresAt
      }
    }
  }

  async register(body: RegisterDTO) {
    let user = await this.getUserByEmail(body.email)

    if (!user) {
      const dateOfBirth = new Date(body.year, body.month - 1, body.day)
      const passwordHash = hashPassword(body.password)
      const userId = new mongoose.Types.ObjectId()

      ;[user] = await Promise.all([
        UserModel.create({
          _id: userId,
          passwordHash,
          dateOfBirth,
          username: generateUsername(body.name),
          ...pick(body, ['name', 'email', 'gender'])
        }),
        SettingsModel.create({
          userId
        })
      ])
    }

    const otpRecord = await otpService.sendOTP({
      purpose: OTP_PURPOSE.EMAIL_VERIFICATION,
      user
    })

    return { user: omit(user.toObject(), ['passwordHash']), otpExpiresAt: otpRecord.expiresAt }
  }

  async logout({ refreshToken }: { refreshToken: string }) {
    return await RefreshTokenModel.deleteOne({
      token: refreshToken
    })
  }

  async getUserByEmail(email: string) {
    return await UserModel.findOne({ email })
  }

  async getUserById(id: string) {
    return await UserModel.findOne({
      _id: id
    })
  }

  async getUserByUsername(username: string) {
    return await UserModel.findOne({
      username
    })
  }

  async updateProfile({ userId, body }: { userId: string; body: UpdateMyProfileDTO }) {
    return await UserModel.findOneAndUpdate({ _id: userId }, body, { new: true })
  }

  async getEmailVerificationStatus(email: string) {
    const user = await this.getUserByEmail(email)
    if (!user) return null
    return user.verify
  }

  async requestEmailVerification(user: IUser) {
    return await otpService.sendOTP({
      purpose: OTP_PURPOSE.EMAIL_VERIFICATION,
      user
    })
  }

  async confirmEmailVerification(userId: string) {
    const user = await UserModel.findByIdAndUpdate(
      userId,
      {
        verify: USER_VERIFY_STATUS.VERIFIED
      },
      { new: true }
    )

    await OTPModel.deleteOne({
      email: user?.email,
      purpose: OTP_PURPOSE.EMAIL_VERIFICATION
    })

    return user
  }

  async requestResetPassword(user: IUser) {
    const otpRecord = await otpService.sendOTP({
      purpose: OTP_PURPOSE.FORGOT_PASSWORD,
      user
    })
    return otpRecord
  }

  async confirmResetPassword({ email, otp }: { otp: string; email: string }) {
    await OTPModel.findOneAndUpdate(
      {
        code: otp,
        email,
        purpose: OTP_PURPOSE.FORGOT_PASSWORD
      },
      {
        verify: true
      }
    )
  }

  async resetPassword({ email, password }: { email: string; password: string }) {
    const user = await UserModel.findOneAndUpdate(
      { email },
      {
        passwordHash: hashPassword(password)
      }
    )

    await OTPModel.deleteOne({
      email: user?.email,
      purpose: OTP_PURPOSE.FORGOT_PASSWORD
    })
  }

  async sendFriendRequest() {}
}

const userService = new UserService()
export default userService
