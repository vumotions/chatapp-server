import 'dotenv/config'
import { z } from 'zod'

const EnvSchema = z.object({
  PORT: z.coerce.number().positive().default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DB_USERNAME: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  MAIL_AUTH_USER: z.string().min(1),
  MAIL_AUTH_PASS: z.string().min(1),
  PASSWORD_SALT: z.string().min(1),
  OTP_EXPIRES_AT: z.coerce.number().default(60)
})

export const env = EnvSchema.parse(process.env)
