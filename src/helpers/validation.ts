import { NextFunction, Request, Response } from 'express'
import { ZodError, ZodType } from 'zod'
import { UnprocessableEntityError, ValidationErrors } from '~/models/error.model'

interface RequestSchemas {
  body?: ZodType<any>
  query?: ZodType<any>
  params?: ZodType<any>
}

const validate = (schemas: RequestSchemas) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validatePromises = []
      if (schemas.body) {
        validatePromises.push(
          schemas.body.parseAsync(req.body).then((result) => {
            req.body = result
          })
        )
      }

      if (schemas.query) {
        validatePromises.push(
          schemas.query.parseAsync(req.query).then((result) => {
            req.query = result
          })
        )
      }

      if (schemas.params) {
        validatePromises.push(
          schemas.params.parseAsync(req.params).then((result) => {
            req.params = result
          })
        )
      }
      await Promise.all(validatePromises)

      return next()
    } catch (error) {
      if (error instanceof ZodError) {
        const errors: ValidationErrors = Object.fromEntries(error.errors.map((err) => [err.path.join('.'), err]))

        return next(new UnprocessableEntityError({ errors }))
      }

      return next(error)
    }
  }
}

export default validate
