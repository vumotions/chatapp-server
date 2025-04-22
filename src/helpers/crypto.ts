import { createHash } from 'crypto'
import { env } from '~/config/env'

const sha256 = (content: string) => createHash('sha256').update(content).digest('hex')

export const hashPassword = (password: string) => {
  return sha256(password + env.PASSWORD_SALT)
}
