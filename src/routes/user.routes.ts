import { Router } from 'express'
import userController from '~/controllers/user.controller'
import { wrapRequestHandler } from '~/helpers/common'
import { registerValidator } from '~/middlewares/user.middleware'

const authRoutes = Router()

authRoutes.post('/register', registerValidator, wrapRequestHandler(userController.register))
authRoutes.post('/login', wrapRequestHandler(userController.login))

export default authRoutes
