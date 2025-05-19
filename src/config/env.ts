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
  OTP_EXPIRES_AT: z.coerce.number().default(60),
  JWT_ACCESS_TOKEN_PRIVATE_KEY: z.string().min(1),
  JWT_REFRESH_TOKEN_PRIVATE_KEY: z.string().min(1),
  JWT_ACCESS_TOKEN_EXPIRES_IN: z.string().min(1),
  JWT_REFRESH_TOKEN_EXPIRES_IN: z.string().min(1),
  WEBSITE_URL: z.string().min(1),
  CLOUDINARY_URL: z.string().min(1),
  CLOUDINARY_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1)
})

export const env = EnvSchema.parse(process.env)
