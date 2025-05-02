import { NextFunction, Request, RequestHandler, Response } from 'express'
import otpGenerator from 'otp-generator'
import slugify from 'slugify'
import { OTP_STATUS } from '~/constants/enums'

export const generateOTP = (digits: number = 6) => {
  return otpGenerator.generate(digits, {
    upperCaseAlphabets: false,
    specialChars: false,
    digits: true,
    lowerCaseAlphabets: false
  })
}

export const generateUsername = (fullName: string) => {
  const base = slugify(fullName, { lower: true, remove: /[*+~.()'"!:@]/g })

  const now = new Date()
  const dateStr = now.toISOString().slice(2, 10).replace(/-/g, '')
  const timeStr =
    now.getHours().toString().padStart(2, '0') + now.getMinutes().toString().padStart(2, '0')

  const suffix = Math.floor(100 + Math.random() * 900)

  return `${base}${dateStr}${timeStr}${suffix}`
}

export const getOTPErrorMessage = (status: OTP_STATUS) => {
  switch (status) {
    case OTP_STATUS.INVALID:
      return 'OTP is invalid'
    case OTP_STATUS.EXPIRED:
      return 'OTP has expired'
    default:
      return 'OTP is invalid'
  }
}
