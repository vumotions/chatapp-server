import { Router } from 'express'
import mailer from '~/services/mail.services'

const authRoutes = Router()

authRoutes.post('/login', async (req, res) => {
  const { email } = req.body as { email: string }

  await mailer.sendMail({
    subject: 'OTP Verification',
    to: email || 'leevudev@gmail.com',
    template: 'otp',
    context: {
      title: 'OTP Verification',
      expiresIn: `${60} seconds`,
      otp: '123456'
    }
  })

  res.json({
    message: 'Login successful',
    user: req.body
  })
})

export default authRoutes
