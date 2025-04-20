import { NextFunction, Request, RequestHandler, Response } from 'express'
import otpGenerator from 'otp-generator'
import slugify from 'slugify'

export const generateOTP = (digits: number = 6) => {
  return otpGenerator.generate(digits, {
    upperCaseAlphabets: false,
    specialChars: false,
    digits: true,
    lowerCaseAlphabets: false
  })
}

export const wrapRequestHandler = (func: RequestHandler): RequestHandler => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await func(req, res, next)
    } catch (error) {
      next(error)
    }
  }
}

export const generateUsername = (fullName: string) => {
  const base = slugify(fullName, { lower: true, remove: /[*+~.()'"!:@]/g })

  const now = new Date()
  const dateStr = now.toISOString().slice(2, 10).replace(/-/g, '')
  const timeStr = now.getHours().toString().padStart(2, '0') + now.getMinutes().toString().padStart(2, '0')

  const suffix = Math.floor(100 + Math.random() * 900)

  return `${base}${dateStr}${timeStr}${suffix}`
}
