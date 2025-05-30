import { IUser } from './models/User.model'
import { TokenPayload } from './types/payload.type'

declare global {
  namespace Express {
    interface Request {
      context?: {
        user?: IUser
        decodedAccessToken?: TokenPayload
        decodedRefreshToken?: TokenPayload
      }
    }
  }
}
