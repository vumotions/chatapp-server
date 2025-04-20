import { status as HTTP_STATUS } from 'http-status'
import { ZodIssue } from 'zod'
import messages from '~/constants/messages'

export type ValidationErrors = Record<string, ZodIssue>

export class AppError {
  message: string
  status: number

  constructor({ message, status }: { message: string; status: number }) {
    this.message = message
    this.status = status
  }
}

export class UnprocessableEntityError extends AppError {
  errors: ValidationErrors
  constructor({ errors, message = messages.UNPROCESSABLE_ENTITY }: { message?: string; errors: ValidationErrors }) {
    super({ message, status: HTTP_STATUS.UNPROCESSABLE_ENTITY })
    this.errors = errors
  }
}
