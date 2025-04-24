import handlebars from 'handlebars'
import nodemailer from 'nodemailer'
import { env } from '~/config/env'
import { SendEmailDTO } from '~/types/mail.type'

import path from 'path'
type MailServiceConfig = {
  user: string
  pass: string
}

class MailService {
  private transporter: nodemailer.Transporter

  constructor(config: MailServiceConfig) {
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: config.user,
        pass: config.pass
      }
    })
  }

  async initialize() {
    const { default: hbs } = await import('nodemailer-express-handlebars')
    this.transporter.use(
      'compile',
      hbs({
        viewEngine: {
          extname: '.hbs',
          defaultLayout: 'main',
          layoutsDir: path.resolve('./src/templates/layouts'),
          partialsDir: path.resolve('./src/templates/partials'),
          handlebars: handlebars
        },
        viewPath: path.resolve('./src/templates/emails'),
        extName: '.hbs'
      })
    )
  }

  async sendMail(dto: SendEmailDTO) {
    return new Promise((resolve, reject) => {
      const { name, to, subject, template, context } = dto
      const mailOptions = {
        from: {
          address: env.MAIL_AUTH_USER,
          name: name || 'Vu Motions'
        },
        to: to,
        subject,
        template,
        context
      }
      this.transporter.sendMail(mailOptions, (error, info) => {
        if (error) return reject(error)
        resolve(info)
      })
    })
  }
}

const mailService = new MailService({
  user: env.MAIL_AUTH_USER,
  pass: env.MAIL_AUTH_PASS
})

mailService.initialize()
export default mailService
