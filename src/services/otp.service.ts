import { env } from '~/config/env'
import { OTP_STATUS } from '~/constants/enums'
import { generateOTP } from '~/helpers/common'
import OTPModel from '~/models/otp.model'
import { IUser } from '~/models/User.model'
import mailService from './mail.service'

class OTPService {
  async verifyOTP({ otp, email }: { otp: string; email: string }) {
    const record = await OTPModel.findOne({
      email,
      code: otp
    })

    if (!record) {
      return OTP_STATUS.INVALID
    }

    if (record.expiresAt < new Date()) {
      return OTP_STATUS.EXPIRED
    }

    return OTP_STATUS.VALID
  }

  async sendOTP({
    user,
    purpose,
    expiresIn
  }: {
    purpose: string
    user: IUser
    expiresIn?: number
  }) {
    await OTPModel.deleteMany({
      email: user.email,
      purpose
    })

    const otpCode = generateOTP(6)
    const _expiresIn = expiresIn || env.OTP_EXPIRES_AT

    const [otpRecord] = await Promise.all([
      OTPModel.create({
        code: otpCode,
        email: user.email,
        purpose,
        expiresAt: new Date(Date.now() + _expiresIn * 1000)
      }),
      mailService.sendMail({
        subject: 'Email verification',
        template: 'otp',
        to: user.email,
        context: {
          title: 'OTP Verification',
          expiresIn: `${_expiresIn} seconds`,
          otp: otpCode
        }
      })
    ])

    return otpRecord
  }
}

const otpService = new OTPService()
export default otpService
