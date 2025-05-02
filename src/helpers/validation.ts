import { NextFunction, Request, Response } from 'express'
import { ZodError, ZodType } from 'zod'
import { UnprocessableEntityError, ValidationErrors } from '~/models/error.model'
import { TransformContext } from '~/models/transform-context.model'

interface RequestSchemas {
  body?: ZodType<any>
  query?: ZodType<any>
  params?: ZodType<any>
  headers?: ZodType<any>
}

const assignContextIfTransformContext = (
  result: any,
  req: Request,
  field: keyof RequestSchemas
) => {
  if (result instanceof TransformContext) {
    req[field] = result.data
    req.context = {
      ...req.context,
      ...result.context
    }
  } else {
    req[field] = result
  }
}

const validate = (schemas: RequestSchemas) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const schemasToValidate: { field: keyof RequestSchemas; schema?: ZodType<any>; data: any }[] =
        [
          { field: 'body', schema: schemas?.body, data: req?.body },
          { field: 'query', schema: schemas?.query, data: req?.query },
          { field: 'params', schema: schemas?.params, data: req?.params },
          { field: 'headers', schema: schemas?.headers, data: req?.headers }
        ]

      const validatePromises = schemasToValidate.map(({ field, schema, data }) => {
        if (schema) {
          return schema.parseAsync(data).then((result) => {
            assignContextIfTransformContext(result, req, field)
          })
        }
        return Promise.resolve()
      })

      await Promise.all(validatePromises)
      return next()
    } catch (error) {
      if (error instanceof ZodError) {
        const errors: ValidationErrors = Object.fromEntries(
          error.errors.map((err) => [err.path.join('.'), err])
        )
        return next(new UnprocessableEntityError({ errors }))
      }

      return next(error)
    }
  }
}

export default validate
