import { pick } from 'lodash'
import { OTP_PURPOSE } from '~/constants/enums'
import { generateUsername } from '~/helpers/common'
import UserModel from '~/models/user.model'
import { RegisterDTO } from '~/schemas/register.schema'
import otpService from './otp.service'
import { hashPassword } from '~/helpers/crypto'
import { LoginDTO } from '~/schemas/login.schemas'

class UserService {
  async login(body: LoginDTO) {}
  async register(body: RegisterDTO) {
    let user = await this.getUserByEmail(body.email)

    if (!user) {
      const dateOfBirth = new Date(body.year, body.month - 1, body.day)
      const passwordHash = hashPassword(body.password)

      user = await UserModel.create({
        passwordHash,
        dateOfBirth,
        username: generateUsername(body.name),
        ...pick(body, ['name', 'email', 'gender'])
      })
    }

    await otpService.sendOTP({
      purpose: OTP_PURPOSE.EMAIL_VERIFICATION,
      user
    })

    return user
  }

  async getUserByEmail(email: string) {
    return await UserModel.findOne({ email })
  }

  async getUserById(id: string) {
    return await UserModel.findOne({
      _id: id
    })
  }
  async getEmailVerificationStatus(email: string) {
    const user = await this.getUserByEmail(email)
    if (!user) return null
    return user.verify
  }
}

const userService = new UserService()
export default userService
