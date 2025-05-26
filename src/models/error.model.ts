import { ZodIssue } from 'zod'

export type ValidationErrors = Record<string, ZodIssue>

export class AppError {
  name: string
  message: string
  status: number

  constructor({
    message,
    name = 'UNKNOWN_ERROR',
    status
  }: {
    message: string
    status: number
    name?: string
  }) {
    this.message = message
    this.status = status
    this.name = name
  }
}

export class UnprocessableEntityError extends AppError {
  errors: ValidationErrors
  constructor({
    errors,
    message = 'UnprocessableEntityError'
  }: {
    message?: string
    errors: ValidationErrors
  }) {
    super({ message, status: 422 })
    this.errors = errors
  }
}
