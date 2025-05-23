import { Router } from 'express'
import uploadController from '~/controllers/upload.controller'
import uploadMiddleware from '~/middlewares/upload.middleware'
import { accessTokenValidator, verifiedUserValidator } from '~/middlewares/auth.middleware'
import { wrapRequestHandler } from '~/helpers/handler'

const uploadRoutes = Router()

// Upload files
uploadRoutes.post(
  '/files',
  uploadMiddleware,
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(uploadController.uploadFiles)
)

export default uploadRoutes
