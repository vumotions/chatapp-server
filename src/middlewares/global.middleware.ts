import { NextFunction, Request, Response } from 'express'
import status from 'http-status'
import { omit } from 'lodash'
import messages from '~/constants/messages'
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

  res.status(status.INTERNAL_SERVER_ERROR).json({
    message: err?.message || messages.INTERNAL_SERVER_ERROR
  })
}

export default defaultErrorHandler
