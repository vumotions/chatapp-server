import { Router } from 'express'
import draftsController from '~/controllers/drafts.controller'
import { wrapRequestHandler } from '~/helpers/handler'
import { accessTokenValidator, verifiedUserValidator } from '~/middlewares/auth.middleware'

const draftsRoutes = Router()

// Lấy tất cả draft messages
draftsRoutes.get(
  '/',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(draftsController.getAllDrafts)
)

// Lấy draft message theo chatId
draftsRoutes.get(
  '/:chatId',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(draftsController.getDraftByChatId)
)

// Lưu draft message
draftsRoutes.post(
  '/',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(draftsController.saveDraft)
)

// Xóa draft message
draftsRoutes.delete(
  '/:draftId',
  accessTokenValidator,
  verifiedUserValidator,
  wrapRequestHandler(draftsController.deleteDraft)
)

export default draftsRoutes