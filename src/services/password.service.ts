import bcrypt from 'bcrypt'
import { env } from '~/config/env'

class PasswordService {
  async hashPwd(plainPwd: string) {
    const hash = await bcrypt.hash(plainPwd, env.SALT_ROUNDS)
    return hash
  }

  async comparePwd(plainPwd: string, hashedPwd: string) {
    return await bcrypt.compare(plainPwd, hashedPwd)
  }
}

const passwordService = new PasswordService()
export default passwordService
