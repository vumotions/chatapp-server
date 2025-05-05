import { NextFunction, Request, Response } from 'express'

class ConversationsController {
  async getUserConversations(req: Request, res: Response, next: NextFunction) {
    res.json('test')
  }

  async getMessagesByConversation(req: Request, res: Response, next: NextFunction) {
    res.json('test')
  }
}

const conversationsController = new ConversationsController()
export default conversationsController
