import { IUser } from './models/user.model'
import { TokenPayload } from './types/payload.type'

declare global {
  namespace Express {
    interface Request {
      context?: {
        user?: IUser
        decodedRefreshToken?: TokenPayload
      }
    }
  }
}
