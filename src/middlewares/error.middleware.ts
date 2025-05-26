import { NextFunction, Request, Response } from 'express'
import { omit } from 'lodash'
import { AppError } from '~/models/error.model'

const defaultErrorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.status).json(omit(err, ['status']))
    return
  }

  Object.getOwnPropertyNames(err).forEach((key) => {
    Object.defineProperty(err, key, {
      enumerable: true
    })
  })

  res.status(500).json({
    message: err?.message || 'Internal Server Error'
  })
}

export default defaultErrorHandler
