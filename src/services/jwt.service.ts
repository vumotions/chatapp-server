import jwt, { SignOptions } from 'jsonwebtoken'
import { TokenPayload } from '~/types/payload.type'

class JwtService {
  async signToken({
    payload,
    privateKey,
    options = {
      algorithm: 'HS256'
    }
  }: {
    payload: string | Buffer | object
    privateKey: string
    options?: SignOptions
  }) {
    return new Promise<string>((resolve, reject) => {
      jwt.sign(payload, privateKey, options, (error, token) => {
        if (error) {
          return reject(error)
        }
        resolve(token as string)
      })
    })
  }

  async verifyToken({ token, secretOrPublicKey }: { token: string; secretOrPublicKey: string }) {
    return new Promise<TokenPayload>((resolve, reject) => {
      jwt.verify(token, secretOrPublicKey, (error, payload) => {
        if (error) {
          return reject(error)
        }

        resolve(payload as TokenPayload)
      })
    })
  }
}

const jwtService = new JwtService()
export default jwtService
