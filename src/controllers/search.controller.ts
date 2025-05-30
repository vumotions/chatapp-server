import { Request, Response, NextFunction } from 'express'
import UserModel from '~/models/User.model'
import PostModel from '~/models/post.model'
import ChatModel from '~/models/chat.model'
import FriendModel from '~/models/friend.model'
import { AppSuccess } from '~/models/success.model'

class SearchController {
  async searchAll(req: Request, res: Response, next: NextFunction) {
    try {
      const { q } = req.query
      const userId = req.context?.user?._id

      if (!q || typeof q !== 'string') {
        res.json(
          new AppSuccess({
            message: 'Search results',
            data: { users: [], posts: [], conversations: [] }
          })
        )
        return
      }

      // Tìm kiếm người dùng
      const users = await UserModel.find({
        $or: [
          { name: { $regex: q, $options: 'i' } },
          { username: { $regex: q, $options: 'i' } },
          { email: { $regex: q, $options: 'i' } }
        ]
      })
        .select('_id name username avatar')
        .limit(10)

      // Tìm kiếm bài viết
      // Lấy danh sách bạn bè
      const friendIds = []
      if (userId) {
        const friends = await FriendModel.find({ userId }).select('friendId')
        if (friends.length > 0) {
          friendIds.push(...friends.map((f) => f.friendId))
        }
      }

      // Điều kiện tìm kiếm bài viết
      const postQuery: any = {
        $or: [
          { content: { $regex: q, $options: 'i' } },
          { 'tags.name': { $regex: q, $options: 'i' } }
        ],
        $and: [
          {
            $or: [
              { post_type: 'public' }, // Bài viết công khai
              { userId: userId } // Bài viết của người dùng hiện tại
            ]
          }
        ]
      }

      // Thêm điều kiện bài viết của bạn bè nếu có bạn bè
      if (friendIds.length > 0) {
        postQuery.$and[0].$or.push({
          $and: [{ userId: { $in: friendIds } }, { post_type: 'friends' }]
        })
      }

      const posts = await PostModel.find(postQuery)
        .populate('userId', '_id name username avatar')
        .select('_id content media post_type created_at userId')
        .sort({ created_at: -1 })
        .limit(10)

      // Tìm kiếm cuộc trò chuyện
      const conversationQuery: any = {
        participants: userId,
        $or: [
          { name: { $regex: q, $options: 'i' } } // Tìm theo tên nhóm
        ]
      }

      const conversations = await ChatModel.find(conversationQuery)
        .populate({
          path: 'participants',
          select: '_id name username avatar',
          match: { _id: { $ne: userId } }
        })
        .populate({
          path: 'lastMessage',
          select: 'content createdAt'
        })
        .select('_id name type lastMessage participants createdAt updatedAt')
        .sort({ updatedAt: -1 })
        .limit(10)

      res.json(
        new AppSuccess({
          message: 'Search results retrieved successfully',
          data: {
            users,
            posts,
            conversations
          }
        })
      )
    } catch (error) {
      next(error)
    }
  }

  async searchUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const { q } = req.query

      if (!q || typeof q !== 'string') {
        res.json(
          new AppSuccess({
            message: 'No search query provided',
            data: []
          })
        )
        return
      }

      const users = await UserModel.find({
        $or: [
          { name: { $regex: q, $options: 'i' } },
          { username: { $regex: q, $options: 'i' } },
          { email: { $regex: q, $options: 'i' } }
        ]
      })
        .select('_id name username avatar')
        .limit(20)

      res.json(
        new AppSuccess({
          message: 'Users found successfully',
          data: users
        })
      )
    } catch (error) {
      next(error)
    }
  }

  async searchPosts(req: Request, res: Response, next: NextFunction) {
    try {
      const { q } = req.query
      const userId = req.context?.user?._id

      if (!q || typeof q !== 'string') {
        res.json(
          new AppSuccess({
            message: 'No search query provided',
            data: []
          })
        )
        return
      }

      // Lấy danh sách bạn bè
      const friendIds = []
      if (userId) {
        const friends = await FriendModel.find({ userId }).select('friendId')
        if (friends.length > 0) {
          friendIds.push(...friends.map((f) => f.friendId))
        }
      }

      // Điều kiện tìm kiếm bài viết
      const postQuery: any = {
        $or: [
          { content: { $regex: q, $options: 'i' } },
          { 'tags.name': { $regex: q, $options: 'i' } }
        ],
        $and: [
          {
            $or: [
              { post_type: 'public' }, // Bài viết công khai
              { userId: userId } // Bài viết của người dùng hiện tại
            ]
          }
        ]
      }

      // Thêm điều kiện bài viết của bạn bè nếu có bạn bè
      if (friendIds.length > 0) {
        postQuery.$and[0].$or.push({
          $and: [{ userId: { $in: friendIds } }, { post_type: 'friends' }]
        })
      }

      const posts = await PostModel.find(postQuery)
        .populate('userId', '_id name username avatar')
        .select('_id content media post_type created_at userId')
        .sort({ created_at: -1 })
        .limit(20)

      res.json(
        new AppSuccess({
          message: 'Posts found successfully',
          data: posts
        })
      )
    } catch (error) {
      next(error)
    }
  }

  async searchConversations(req: Request, res: Response, next: NextFunction) {
    try {
      const { q } = req.query
      const userId = req.context?.user?._id

      if (!q || typeof q !== 'string' || !userId) {
        res.json(
          new AppSuccess({
            message: 'No search query or user ID provided',
            data: []
          })
        )
        return
      }

      // Tìm kiếm cuộc trò chuyện mà người dùng tham gia
      const conversationQuery: any = {
        participants: userId,
        $or: [
          { name: { $regex: q, $options: 'i' } } // Tìm theo tên nhóm
        ]
      }

      const conversations = await ChatModel.find(conversationQuery)
        .populate({
          path: 'participants',
          select: '_id name username avatar',
          match: { _id: { $ne: userId } }
        })
        .populate({
          path: 'lastMessage',
          select: 'content createdAt'
        })
        .select('_id name type lastMessage participants createdAt updatedAt')
        .sort({ updatedAt: -1 })
        .limit(20)

      res.json(
        new AppSuccess({
          message: 'Conversations found successfully',
          data: conversations
        })
      )
    } catch (error) {
      next(error)
    }
  }
}

export default new SearchController()
