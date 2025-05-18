/* eslint-disable @typescript-eslint/no-explicit-any */
import { Request, Response } from 'express'
import PostModel from '~/models/post.model'
import uploadService from '~/services/upload.service'
import PostLikeModel from '~/models/post-like.model'
import PostCommentModel from '~/models/post-comment.model'
import NotificationModel from '~/models/notification.model'

class PostController {
  async uploadeAPost(req: Request, res: Response): Promise<any> {
    try {
      const userId = req.context?.user?._id
      const { content, postType } = req.body
      const files = req.files as Express.Multer.File[]
      const uploadedFiles = await uploadService.uploadFiles(files)
      const data = {
        user_id: userId,
        content,
        post_type: postType,
        media: uploadedFiles
      }
      await PostModel.create(data)
      return res.status(200).json({ message: 'success' })
    } catch (error) {
      return res.status(500).json({ message: error })
    }
  }
  async getPost(req: Request, res: Response): Promise<any> {
    try {
      const { postTypes, page, limit, userId } = req.query
      const currentUserId = req.context?.user?._id
      // Convert query params to appropriate types
      const pageNumber = parseInt(page as string) || 1
      const limitNumber = parseInt(limit as string) || 10
      const skip = (pageNumber - 1) * limitNumber

      // Build query object
      const query: any = {}
      if (userId) {
        query.user_id = userId
      }
      if (postTypes) {
        const types = (postTypes as string).split(',')
        // Only allow private posts if currentUserId matches userId
        if (currentUserId !== userId) {
          query.post_type = { $in: types.filter((type) => type !== 'private') }
        } else {
          query.post_type = { $in: types }
        }
      }

      // Get posts with pagination
      const posts = await PostModel.find(query)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limitNumber)
        .populate('user_id')

      // Get total count for pagination
      const total = await PostModel.countDocuments(query)

      // Get likes for each post and check if current user liked each post
      const postsWithLikes = await Promise.all(
        posts.map(async (post) => {
          const likesCount = await PostLikeModel.countDocuments({ postId: post._id })
          const userLiked = currentUserId 
            ? await PostLikeModel.exists({ postId: post._id, userId: currentUserId })
            : false

          return {
            ...post.toObject(),
            likesCount,
            userLiked: !!userLiked
          }
        })
      )

      return res.status(200).json({
        message: 'Get posts successfully',
        data: postsWithLikes,
        pagination: {
          page: pageNumber,
          limit: limitNumber,
          total,
          totalPages: Math.ceil(total / limitNumber)
        }
      })
    } catch (error) {
      return res.status(500).json({ message: error })
    }
  }

  async getPostComments(req: Request, res: Response): Promise<any> {
    try {
      const { postId, parentId, page, limit } = req.query
      
      if (!postId) {
        return res.status(400).json({ message: 'Post ID is required' })
      }
      
      // Convert query params to appropriate types
      const pageNumber = parseInt(page as string) || 1
      const limitNumber = parseInt(limit as string) || 10
      const skip = (pageNumber - 1) * limitNumber
      
      // Build query object
      const query: any = { postId }
      if (parentId) {
        query.parentId = parentId
      } else {
        query.parentId = { $exists: false } // Get only top-level comments
      }
      
      // Get comments with pagination
      const comments = await PostCommentModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNumber)
        .populate('userId', 'name avatar')
      
      // Get total count for pagination
      const total = await PostCommentModel.countDocuments(query)
      
      // For each top-level comment, get the count of replies
      const commentsWithReplyCounts = await Promise.all(
        comments.map(async (comment) => {
          const replyCount = await PostCommentModel.countDocuments({ parentId: comment._id })
          return {
            ...comment.toObject(),
            replyCount
          }
        })
      )
      
      return res.status(200).json({
        message: 'Get comments successfully',
        data: commentsWithReplyCounts,
        pagination: {
          page: pageNumber,
          limit: limitNumber,
          total,
          totalPages: Math.ceil(total / limitNumber)
        }
      })
    } catch (error) {
      return res.status(500).json({ message: error })
    }
  }

  async createComment(req: Request, res: Response): Promise<any> {
    try {
      const userId = req.context?.user?._id
      const { postId, content, parentId } = req.body
      
      if (!postId || !content) {
        return res.status(400).json({ message: 'Post ID and content are required' })
      }
      
      // Create the comment
      const comment = await PostCommentModel.create({
        userId,
        postId,
        content,
        parentId: parentId || null
      })
      
      // Populate user data for the response
      const populatedComment = await PostCommentModel.findById(comment._id)
        .populate('userId', 'name avatar')
      
      // Update comment count on the post
      await PostModel.findByIdAndUpdate(postId, { $inc: { comment_count: 1 } })
      
      // Emit socket event for real-time updates
      const { io } = require('~/lib/socket')
      if (io) {
        io.to(postId.toString()).emit('NEW_COMMENT', populatedComment)
      }
      
      // If this is a reply, notify the parent comment author
      if (parentId) {
        const parentComment = await PostCommentModel.findById(parentId)
        if (parentComment && parentComment.userId.toString() !== userId.toString()) {
          // Create notification for parent comment author
          const notification = await NotificationModel.create({
            userId: parentComment.userId,
            senderId: userId,
            type: 'COMMENT_REPLY',
            relatedId: comment._id
          })
          
          // Emit notification to parent comment author if online
          const { users } = require('~/lib/socket')
          const recipientSocketId = users.get(parentComment.userId.toString())
          if (recipientSocketId) {
            io.to(recipientSocketId).emit('NOTIFICATION_NEW', notification)
          }
        }
      } else {
        // Notify post author about the comment if not self-commenting
        const post = await PostModel.findById(postId)
        if (post && post.user_id.toString() !== userId.toString()) {
          // Create notification for post author
          const notification = await NotificationModel.create({
            userId: post.user_id,
            senderId: userId,
            type: 'POST_COMMENT',
            relatedId: comment._id
          })
          
          // Emit notification to post author if online
          const { users } = require('~/lib/socket')
          const recipientSocketId = users.get(post.user_id.toString())
          if (recipientSocketId) {
            io.to(recipientSocketId).emit('NOTIFICATION_NEW', notification)
          }
        }
      }
      
      return res.status(201).json({
        message: 'Comment created successfully',
        data: populatedComment
      })
    } catch (error) {
      return res.status(500).json({ message: error })
    }
  }

  async likePost(req: Request, res: Response): Promise<any> {
    try {
      const userId = req.context?.user?._id
      const { postId } = req.body

      if (!postId) {
        return res.status(400).json({ message: 'Post ID is required' })
      }

      // Check if post exists
      const post = await PostModel.findById(postId)
      if (!post) {
        return res.status(404).json({ message: 'Post not found' })
      }

      // Check if user already liked the post
      const existingLike = await PostLikeModel.findOne({ userId, postId })
      if (existingLike) {
        return res.status(400).json({ message: 'You already liked this post' })
      }

      // Create the like
      await PostLikeModel.create({ userId, postId })

      // Get updated like count
      const likesCount = await PostLikeModel.countDocuments({ postId })

      // Create notification for post author if not self-liking
      if (post.user_id.toString() !== userId.toString()) {
        const notification = await NotificationModel.create({
          userId: post.user_id,
          senderId: userId,
          type: 'POST_LIKE',
          relatedId: postId
        })

        // Emit notification to post author if online
        const { io, users } = require('~/lib/socket')
        const recipientSocketId = users.get(post.user_id.toString())
        if (recipientSocketId && io) {
          io.to(recipientSocketId).emit('NOTIFICATION_NEW', notification)
        }
      }

      return res.status(200).json({
        message: 'Post liked successfully',
        data: { likesCount, userLiked: true }
      })
    } catch (error) {
      return res.status(500).json({ message: error })
    }
  }

  async deleteLikePost(req: Request, res: Response): Promise<any> {
    try {
      const userId = req.context?.user?._id
      const { postId } = req.params

      if (!postId) {
        return res.status(400).json({ message: 'Post ID is required' })
      }

      // Check if post exists
      const post = await PostModel.findById(postId)
      if (!post) {
        return res.status(404).json({ message: 'Post not found' })
      }

      // Find and delete the like
      const deletedLike = await PostLikeModel.findOneAndDelete({ userId, postId })
      if (!deletedLike) {
        return res.status(404).json({ message: 'Like not found' })
      }

      // Get updated like count
      const likesCount = await PostLikeModel.countDocuments({ postId })

      // Delete any related notifications
      if (post.user_id.toString() !== userId.toString()) {
        await NotificationModel.deleteMany({
          userId: post.user_id,
          senderId: userId,
          type: 'POST_LIKE',
          relatedId: postId
        })
      }

      return res.status(200).json({
        message: 'Post unliked successfully',
        data: { likesCount, userLiked: false }
      })
    } catch (error) {
      return res.status(500).json({ message: error })
    }
  }
}
const postController = new PostController()
export default postController
