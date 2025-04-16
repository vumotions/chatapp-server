import { Address } from 'nodemailer/lib/mailer'

export type SendEmailDTO = {
  name?: string
  to: string | string[] | Address | Address[]
  subject: string
  template: string
  [key: string]: any
}
