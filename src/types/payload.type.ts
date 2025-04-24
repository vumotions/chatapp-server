import { JwtPayload } from 'jsonwebtoken'
import { TOKEN_TYPE, USER_VERIFY_STATUS } from '~/constants/enums'

export interface TokenPayload extends JwtPayload {
  userId: string
  tokenType: TOKEN_TYPE
  verify: USER_VERIFY_STATUS
  exp: number
  iat: number
}
