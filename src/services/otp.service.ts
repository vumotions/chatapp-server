import { generateOTP } from '~/helpers/common'
import OTPModel from '~/models/otp.model'
import { IUser } from '~/models/user.model'
import mailService from './mail.service'

class OTPService {
  async verifyOTP() {}

  async sendOTP({ user, purpose, expiresAt }: { purpose: string; user: IUser; expiresAt?: Date }) {
    const otpCode = generateOTP(6)

    await Promise.all([
      OTPModel.create({
        code: otpCode,
        userId: user._id,
        purpose,
        expiresAt: expiresAt || new Date(Date.now() + 60 * 1000) // 60s
      }),
      mailService.sendMail({
        subject: 'Email verification',
        template: 'otp',
        to: user.email,
        context: {
          title: 'OTP Verification',
          expiresIn: `${60} seconds`,
          otp: otpCode
        }
      })
    ])

    return otpCode
  }
}

const otpService = new OTPService()
export default otpService
