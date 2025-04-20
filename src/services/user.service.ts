import { pick } from 'lodash'
import { generateUsername } from '~/helpers/common'
import UserModel from '~/models/user.model'
import { RegisterDTO } from '~/schemas/user.schemas'
import passwordService from './password.service'
import otpService from './otp.service'

class UserService {
  async register(body: RegisterDTO) {
    const dateOfBirth = new Date(body.year, body.month - 1, body.day)
    const passwordHash = await passwordService.hashPwd(body.password)
    const user = await UserModel.create({
      passwordHash,
      dateOfBirth,
      username: generateUsername(body.name),
      ...pick(body, ['name', 'email', 'gender'])
    })

    await otpService.sendOTP({
      purpose: 'EMAIL_VERIFICATION',
      user
    })

    return user
  }

  async checkEmailExists(email: string) {
    const user = await UserModel.findOne({ email, verify: 'VERIFIED' }).lean()
    return Boolean(user)
  }
}

const userService = new UserService()
export default userService
