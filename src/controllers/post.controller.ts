/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextFunction, Request, Response } from 'express'
import mongoose from 'mongoose'
import { AppError } from '~/models/error.model'
import CommentLikeModel from '~/models/comment-like.model'
import NotificationModel from '~/models/notification.model'
import PostCommentModel from '~/models/post-comment.model'
import PostLikeModel from '~/models/post-like.model'
import PostModel from '~/models/post.model'
import uploadService from '~/services/upload.service'
import { emitSocketEvent } from '~/lib/socket'

class PostController {
  async uploadeAPost(req: Request, res: Response): Promise<any> {
    try {
      const userId = req.context?.user?._id
      const { content, postType } = req.body
      const files = req.files as Express.Multer.File[]

      if (!userId) {
        return res.status(400).json({ message: 'User ID is required' }) // BAD_REQUEST
      }

      // Upload files và nhận về mảng đối tượng media
      const uploadedFiles = await uploadService.uploadFiles(files)

      // Tạo đối tượng dữ liệu với tên trường đúng
      const postData = {
        userId: userId,
        content: content || '',
        post_type: postType || 'public',
        media: uploadedFiles
      }

      console.log('Creating post with data:', JSON.stringify(postData, null, 2))

      // Tạo bài viết mới
      const post = await PostModel.create(postData)

      return res.status(200).json({
        message: 'Post created successfully',
        data: post
      })
    } catch (error) {
      console.error('Error creating post:', error)
      return res.status(500).json({ message: 'Internal server error' }) // INTERNAL_SERVER_ERROR
    }
  }
  // Phiên bản đơn giản hơn của getPost để debug
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
        query.userId = userId
      }

      if (postTypes) {
        const types = (postTypes as string).split(',')
        if (currentUserId?.toString() !== userId?.toString()) {
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
        .populate('userId', 'name username avatar')
        .populate({
          path: 'shared_post',
          populate: {
            path: 'userId',
            select: 'name username avatar'
          }
        })
        .lean()

      // Xử lý thêm thông tin cho shared post
      const postsWithSharedData = posts.map((post) => {
        if (post.shared_post) {
          return {
            ...post,
            shared_post_data: post.shared_post
          }
        }
        return post
      })

      // Get total count for pagination
      const total = await PostModel.countDocuments(query)

      // Trả về kết quả với định dạng phù hợp cho infinite query
      return res.status(200).json({
        message: 'Get posts successfully',
        data: {
          posts: postsWithSharedData,
          currentPage: pageNumber,
          totalPages: Math.ceil(total / limitNumber),
          hasMore: pageNumber < Math.ceil(total / limitNumber)
        }
      })
    } catch (error: any) {
      console.error('Error in getPosts:', error)
      return res.status(500).json({ message: error.message || 'Internal server error' })
    }
  }
  async getComments(req: Request, res: Response): Promise<any> {
    try {
      const { id } = req.params
      const { page = '1', limit = '10' } = req.query
      const userId = req.context?.user?._id

      const pageNum = parseInt(page as string)
      const limitNum = parseInt(limit as string)

      // Validate postId
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: 'Invalid Post ID format' })
      }

      const postObjectId = new mongoose.Types.ObjectId(id)

      // Check if post exists
      const post = await PostModel.findById(postObjectId)
      if (!post) {
        return res.status(404).json({ message: 'Post not found' })
      }

      // Fetch all comments for the post
      const comments = await PostCommentModel.find({ postId: postObjectId })
        .populate('userId', 'name avatar username')
        .lean()

      // Get all comment IDs
      const commentIds = comments.map((comment) => comment._id)

      // Fetch all likes for these comments
      const likes = await CommentLikeModel.find({ commentId: { $in: commentIds } }).lean()

      // Calculate like counts
      const likeCounts: any = {}
      likes.forEach((like) => {
        const commentIdStr = like.commentId.toString()
        likeCounts[commentIdStr] = (likeCounts[commentIdStr] || 0) + 1
      })

      // Fetch current user's likes if userId exists
      let userLikedCommentIds = new Set()
      if (userId) {
        const userLikes = await CommentLikeModel.find({
          commentId: { $in: commentIds },
          userId
        }).lean()
        userLikedCommentIds = new Set(userLikes.map((like) => like.commentId.toString()))
      }

      // Build comment map with additional fields
      const commentMap: any = {}
      comments.forEach((comment) => {
        const commentIdStr = comment._id.toString()
        commentMap[commentIdStr] = {
          ...comment,
          likesCount: likeCounts[commentIdStr] || 0,
          userLiked: userLikedCommentIds.has(commentIdStr),
          comments: [] // Initialize empty array for replies
        }
      })

      // Build the comment tree
      const rootComments: any[] = []
      const addedAsReply = new Set()

      // First pass: Add root comments and attach replies to parents
      comments.forEach((comment) => {
        const commentIdStr = comment._id.toString()
        if (!comment.parentId) {
          rootComments.push(commentMap[commentIdStr])
        } else {
          const parentIdStr = comment.parentId.toString()
          if (commentMap[parentIdStr]) {
            commentMap[parentIdStr].comments.push(commentMap[commentIdStr])
            addedAsReply.add(commentIdStr)
          }
        }
      })

      // Second pass: Add orphaned comments (with parentId but parent not found) as root comments
      comments.forEach((comment) => {
        const commentIdStr = comment._id.toString()
        if (comment.parentId && !addedAsReply.has(commentIdStr)) {
          rootComments.push(commentMap[commentIdStr])
        }
      })

      // Sort root comments by createdAt descending (newest first)
      rootComments.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

      // Recursively sort replies by createdAt ascending (oldest first)
      function sortReplies(comment: any) {
        if (comment.comments && comment.comments.length > 0) {
          comment.comments.sort(
            (a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          )
          comment.comments.forEach(sortReplies)
        }
      }
      rootComments.forEach(sortReplies)

      // Paginate root comments
      const totalRootComments = rootComments.length
      const startIndex = (pageNum - 1) * limitNum
      const endIndex = startIndex + limitNum
      const paginatedRootComments = rootComments.slice(startIndex, endIndex)

      const totalPages = Math.ceil(totalRootComments / limitNum)

      // Return response
      return res.status(200).json({
        message: 'Get comments successfully',
        data: paginatedRootComments,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: totalRootComments,
          totalPages
        }
      })
    } catch (error: any) {
      console.error('Error in getComments:', error)
      return res.status(500).json({ message: error.message || 'Internal server error' })
    }
  }

  async createComment(req: Request, res: Response, next: NextFunction): Promise<any> {
    try {
      const { postId, content, parentId, tempId } = req.body
      const userId = req.context?.user?._id

      // Validate input
      if (!postId || !content) {
        throw new AppError({
          message: 'Post ID and content are required',
          status: 400 // BAD_REQUEST
        })
      }

      // Kiểm tra xem postId có phải ObjectId hợp lệ không
      if (!mongoose.Types.ObjectId.isValid(postId)) {
        console.log('Invalid postId format:', postId)
        throw new AppError({
          message: 'Invalid Post ID format',
          status: 400 // BAD_REQUEST
        })
      }

      // Tìm bài viết để lấy thông tin người tạo
      const post = await PostModel.findById(postId)
      if (!post) {
        throw new AppError({
          message: 'Post not found',
          status: 404 // NOT_FOUND
        })
      }

      // Tạo đối tượng comment
      const commentData: any = {
        userId,
        postId,
        content
      }

      // Chỉ thêm parentId nếu có giá trị
      if (parentId) {
        commentData.parentId = parentId
      }

      console.log('Creating comment with data:', commentData)

      // Create the comment
      const comment = await PostCommentModel.create(commentData)

      console.log('Comment created successfully:', comment)

      // Populate user data for the response
      const populatedComment = await PostCommentModel.findById(comment._id).populate(
        'userId',
        'name avatar username'
      )

      // Update comment count on the post
      await PostModel.findByIdAndUpdate(postId, { $inc: { comment_count: 1 } })

      // Emit socket event for real-time comments
      const { io } = require('~/lib/socket')
      if (io) {
        // Tạo room name từ postId
        const roomName = `post:${postId}`

        // Emit sự kiện NEW_COMMENT đến tất cả người dùng đang xem bài viết
        // Thêm userId vào dữ liệu để client có thể lọc
        io.to(roomName).emit('NEW_COMMENT', {
          comment: populatedComment,
          isReply: !!parentId,
          creatorId: userId?.toString() // Thêm creatorId để client có thể lọc
        })

        console.log(`Emitted NEW_COMMENT event to room ${roomName}`)

        // Nếu là reply, emit thêm sự kiện NEW_REPLY cho comment cha
        if (parentId) {
          const replyRoomName = `comment:${parentId}`
          io.to(replyRoomName).emit('NEW_REPLY', {
            comment: populatedComment,
            parentId,
            creatorId: userId?.toString() // Thêm creatorId để client có thể lọc
          })
          console.log(`Emitted NEW_REPLY event to room ${replyRoomName}`)
        }
      }

      // Tạo thông báo cho chủ bài viết nếu người bình luận không phải chủ bài viết
      if (post.userId.toString() !== userId?.toString()) {
        try {
          // Tạo nội dung thông báo phù hợp hơn
          let notificationContent = ''

          // Lấy nội dung bình luận (giới hạn độ dài)
          const truncatedContent = content.length > 50 ? content.substring(0, 50) + '...' : content

          // Nếu là reply cho comment khác
          if (parentId) {
            notificationContent = `đã trả lời một bình luận trong bài viết của bạn: "${truncatedContent}"`
          } else {
            notificationContent = `đã bình luận về bài viết của bạn: "${truncatedContent}"`
          }

          // Tạo thông báo với nội dung tùy chỉnh
          const notification = await NotificationModel.create({
            userId: post.userId,
            senderId: userId,
            type: 'NEW_COMMENT',
            relatedId: postId,
            content: notificationContent
          })

          // Gửi thông báo qua socket nếu chủ bài viết đang online
          if (io) {
            const { users } = require('~/lib/socket')
            const recipientSocketId = users.get(post.userId.toString())
            if (recipientSocketId) {
              io.to(recipientSocketId).emit('NOTIFICATION_NEW', notification)
            }
          }
        } catch (notifError) {
          console.error('Error creating comment notification:', notifError)
        }
      }

      return res.status(201).json({
        message: 'Comment created successfully',
        data: populatedComment
      })
    } catch (error: any) {
      console.error('Error in createComment:', error)
      if (error instanceof AppError) {
        return next(error)
      }
      return next(
        new AppError({
          message: error.message || 'Internal server error',
          status: 500 // INTERNAL_SERVER_ERROR
        })
      )
    }
  }

  async likePost(req: Request, res: Response): Promise<any> {
    try {
      const userId = req.context?.user?._id
      const { postId } = req.body

      if (!userId) {
        return res.status(400).json({ message: 'User ID is required' })
      }

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

      // Toggle like status
      if (existingLike) {
        // User already liked the post, so unlike it
        await PostLikeModel.findByIdAndDelete(existingLike._id)

        // Get updated like count
        const likesCount = await PostLikeModel.countDocuments({ postId })

        // Emit socket event for real-time likes
        try {
          const roomName = `post:${postId}`
          const emitted = emitSocketEvent(roomName, 'POST_LIKE_UPDATED', {
            postId,
            likesCount
          })
          if (emitted) {
            console.log(`Emitted POST_LIKE_UPDATED event to room ${roomName}`)
          }
        } catch (socketError) {
          console.error('Socket error in likePost (unlike):', socketError)
        }

        // Delete any related notifications
        try {
          if (post.userId?.toString() !== userId?.toString()) {
            await NotificationModel.deleteMany({
              userId: post.userId,
              senderId: userId,
              type: 'POST_LIKE',
              relatedId: postId
            })
          }
        } catch (notifError) {
          console.error('Notification deletion error:', notifError)
        }

        return res.status(200).json({
          message: 'Post unliked successfully',
          data: { likesCount, userLiked: false }
        })
      } else {
        // User hasn't liked the post yet, so like it
        await PostLikeModel.create({ userId, postId })

        // Get updated like count
        const likesCount = await PostLikeModel.countDocuments({ postId })

        // Emit socket event for real-time likes
        try {
          const roomName = `post:${postId}`
          const emitted = emitSocketEvent(roomName, 'POST_LIKE_UPDATED', {
            postId,
            likesCount
          })
          if (emitted) {
            console.log(`Emitted POST_LIKE_UPDATED event to room ${roomName}`)
          }
        } catch (socketError) {
          console.error('Socket error in likePost (like):', socketError)
        }

        // Create notification for post author if not self-liking
        try {
          if (post.userId?.toString() !== userId?.toString()) {
            const notification = await NotificationModel.create({
              userId: post.userId,
              senderId: userId,
              type: 'POST_LIKE',
              relatedId: postId
            })

            // Emit notification to post author if online
            try {
              const { users } = require('~/lib/socket')
              const recipientSocketId = users.get(post.userId?.toString())
              if (recipientSocketId) {
                emitSocketEvent(recipientSocketId, 'NOTIFICATION_NEW', notification)
              }
            } catch (notifSocketError) {
              console.error('Notification socket error:', notifSocketError)
            }
          }
        } catch (notifError) {
          console.error('Notification creation error:', notifError)
        }

        return res.status(200).json({
          message: 'Post liked successfully',
          data: { likesCount, userLiked: true }
        })
      }
    } catch (error: any) {
      console.error('Error in likePost:', error)
      return res.status(500).json({ message: error.message || 'Internal server error' })
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

      // Emit socket event for real-time likes
      try {
        const roomName = `post:${postId}`
        const emitted = emitSocketEvent(roomName, 'POST_LIKE_UPDATED', {
          postId,
          likesCount
        })
        if (emitted) {
          console.log(`Emitted POST_LIKE_UPDATED event to room ${roomName}`)
        }
      } catch (socketError) {
        console.error('Socket error in deleteLikePost:', socketError)
      }

      // Delete any related notifications
      try {
        if (post.userId?.toString() !== userId?.toString()) {
          await NotificationModel.deleteMany({
            userId: post.userId,
            senderId: userId,
            type: 'POST_LIKE',
            relatedId: postId
          })
        }
      } catch (notifError) {
        console.error('Notification deletion error:', notifError)
      }

      return res.status(200).json({
        message: 'Post unliked successfully',
        data: { likesCount, userLiked: false }
      })
    } catch (error: any) {
      console.error('Error in deleteLikePost:', error)
      return res.status(500).json({ message: error.message || 'Internal server error' })
    }
  }

  async likeComment(req: Request, res: Response): Promise<any> {
    try {
      const userId = req.context?.user?._id
      const { commentId } = req.body

      if (!commentId) {
        return res.status(400).json({ message: 'Comment ID is required' })
      }

      // Check if comment exists
      const comment = await PostCommentModel.findById(commentId)
      if (!comment) {
        return res.status(404).json({ message: 'Comment not found' })
      }

      // Check if user already liked the comment
      const existingLike = await CommentLikeModel.findOne({ userId, commentId })

      // Toggle like status
      if (existingLike) {
        // User already liked the comment, so unlike it
        await CommentLikeModel.findByIdAndDelete(existingLike._id)

        // Get updated like count
        const likesCount = await CommentLikeModel.countDocuments({ commentId })

        // Emit socket event for real-time likes
        const { io } = require('~/lib/socket')
        if (io) {
          // Emit sự kiện COMMENT_LIKE_UPDATED cho comment room
          const roomName = `comment:${commentId}`
          io.to(roomName).emit('COMMENT_LIKE_UPDATED', {
            commentId,
            likesCount
          })
          console.log(`Emitted COMMENT_LIKE_UPDATED event to room ${roomName}`)
        }

        return res.status(200).json({
          message: 'Comment unliked successfully',
          data: { likesCount, userLiked: false }
        })
      } else {
        // Create the like
        await CommentLikeModel.create({ userId, commentId })

        // Get updated like count
        const likesCount = await CommentLikeModel.countDocuments({ commentId })

        // Emit socket event for real-time likes
        const { io } = require('~/lib/socket')
        if (io) {
          // Emit sự kiện COMMENT_LIKE_UPDATED cho comment room
          const roomName = `comment:${commentId}`
          io.to(roomName).emit('COMMENT_LIKE_UPDATED', {
            commentId,
            likesCount
          })
          console.log(`Emitted COMMENT_LIKE_UPDATED event to room ${roomName}`)
        }

        return res.status(200).json({
          message: 'Comment liked successfully',
          data: { likesCount, userLiked: true }
        })
      }
    } catch (error: any) {
      return res.status(500).json({ message: error })
    }
  }

  async unlikeComment(req: Request, res: Response): Promise<any> {
    try {
      const userId = req.context?.user?._id
      const { commentId } = req.params

      if (!commentId) {
        return res.status(400).json({ message: 'Comment ID is required' })
      }

      // Check if comment exists
      const comment = await PostCommentModel.findById(commentId)
      if (!comment) {
        return res.status(404).json({ message: 'Comment not found' })
      }

      // Find and delete the like
      const deletedLike = await CommentLikeModel.findOneAndDelete({ userId, commentId })
      if (!deletedLike) {
        return res.status(404).json({ message: 'Like not found' })
      }

      // Get updated like count
      const likesCount = await CommentLikeModel.countDocuments({ commentId })

      // Emit socket event for real-time likes
      const { io } = require('~/lib/socket')
      if (io) {
        // Emit sự kiện COMMENT_LIKE_UPDATED cho comment room
        const roomName = `comment:${commentId}`
        io.to(roomName).emit('COMMENT_LIKE_UPDATED', {
          commentId,
          likesCount
        })
        console.log(`Emitted COMMENT_LIKE_UPDATED event to room ${roomName}`)
      }

      return res.status(200).json({
        message: 'Comment unliked successfully',
        data: { likesCount, userLiked: false }
      })
    } catch (error: any) {
      return res.status(500).json({ message: error })
    }
  }

  // Thêm phương thức để lấy bài viết theo ID
  async getPostById(req: Request, res: Response): Promise<any> {
    try {
      const { postId } = req.params
      const currentUserId = req.context?.user?._id

      if (!postId) {
        return res.status(400).json({ message: 'Post ID is required' })
      }

      // Tìm bài viết theo ID và populate thông tin user
      const post = await PostModel.findById(postId).populate('userId', 'name username avatar')

      if (!post) {
        return res.status(404).json({ message: 'Post not found' })
      }

      // Kiểm tra quyền truy cập nếu bài viết là private
      if (
        post.post_type === 'private' &&
        post.userId._id.toString() !== currentUserId?.toString()
      ) {
        return res.status(403).json({ message: 'You do not have permission to view this post' })
      }

      // Đếm số lượt thích
      const likesCount = await PostLikeModel.countDocuments({ postId: post._id })

      // Kiểm tra người dùng hiện tại đã thích bài viết chưa
      const userLiked = currentUserId
        ? await PostLikeModel.exists({ postId: post._id, userId: currentUserId })
        : false

      // Lấy danh sách người dùng đã like bài viết (giới hạn 10 người mới nhất)
      const likedUsers = await PostLikeModel.find({ postId: post._id })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('userId', 'name username avatar')
        .lean()

      // Đếm số bình luận
      const commentsCount = await PostCommentModel.countDocuments({ postId: post._id })

      // Nếu là bài viết chia sẻ, lấy thông tin bài viết gốc
      let sharedPostData = null
      if (post.shared_post) {
        sharedPostData = await PostModel.findById(post.shared_post)
          .populate('userId', 'name username avatar')
          .lean()
      }

      // Chuyển đổi post thành plain object
      const postObject = post.toObject()

      // Trả về dữ liệu bài viết với thông tin bổ sung và đảm bảo tính nhất quán
      return res.status(200).json({
        message: 'Post retrieved successfully',
        data: {
          ...postObject,
          likesCount,
          commentsCount,
          userLiked: !!userLiked,
          likedUsers: likedUsers.map((like) => like.userId), // Chỉ lấy thông tin người dùng
          shared_post_data: sharedPostData
        }
      })
    } catch (error: any) {
      console.error('Error getting post by ID:', error)
      return res.status(500).json({ message: error.message || 'Internal server error' })
    }
  }

  // Phương thức sharePost đã sửa lỗi
  async sharePost(req: Request, res: Response): Promise<any> {
    try {
      const userId = req.context?.user?._id
      const { postId } = req.body

      console.log('sharePost called with:', { userId, postId })

      if (!postId) {
        return res.status(400).json({ message: 'Post ID is required' })
      }

      if (!userId) {
        return res.status(400).json({ message: 'User ID is required' })
      }

      // Kiểm tra xem bài viết có tồn tại không
      const originalPost = await PostModel.findById(postId)
      if (!originalPost) {
        return res.status(404).json({ message: 'Post not found' })
      }

      console.log('Creating shared post with:', { userId, postId })

      // Tạo bài viết chia sẻ - sử dụng tên trường đúng (userId thay vì user_id)
      const sharedPost = await PostModel.create({
        userId: userId, // Sử dụng userId thay vì user_id
        content: '',
        post_type: 'public',
        shared_post: postId
      })

      console.log('Shared post created:', sharedPost)

      // Tạo thông báo cho tác giả bài viết gốc (nếu không phải tự chia sẻ)
      const originalUserId = originalPost.userId || originalPost.userId
      if (originalUserId && userId && originalUserId?.toString() !== userId?.toString()) {
        await NotificationModel.create({
          userId: originalUserId,
          senderId: userId,
          type: 'POST_SHARE',
          relatedId: postId
        })
      }

      return res.status(200).json({
        message: 'Post shared successfully',
        data: sharedPost
      })
    } catch (error: any) {
      console.error('Error sharing post:', error)
      return res.status(500).json({ message: 'Failed to share post' })
    }
  }

  // Phương thức để lấy bài viết của người dùng theo userId
  async getUserPosts(req: Request, res: Response): Promise<any> {
    try {
      const { userId } = req.params
      const { page, limit } = req.query
      const currentUserId = req.context?.user?._id

      // Convert query params to appropriate types
      const pageNumber = parseInt(page as string) || 1
      const limitNumber = parseInt(limit as string) || 5
      const skip = (pageNumber - 1) * limitNumber

      // Kiểm tra userId hợp lệ
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ message: 'Invalid user ID' })
      }

      // Build query object
      const query: any = { userId: userId }

      // Chỉ hiển thị bài viết public nếu không phải người dùng hiện tại
      if (currentUserId?.toString() !== userId) {
        query.post_type = { $ne: 'private' }
      }

      // Get posts with pagination
      const posts = await PostModel.find(query)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limitNumber)
        .populate('userId', 'name username avatar')
        .lean()

      // Get total count for pagination
      const total = await PostModel.countDocuments(query)

      // Xử lý các bài viết để thêm thông tin bổ sung
      const processedPosts = await Promise.all(
        posts.map(async (post) => {
          try {
            // Đếm số lượt thích
            const likesCount = await PostLikeModel.countDocuments({ postId: post._id })

            // Kiểm tra người dùng hiện tại đã thích bài viết chưa
            const userLiked = currentUserId
              ? await PostLikeModel.exists({ postId: post._id, userId: currentUserId })
              : false

            // Đếm số bình luận
            const commentsCount = await PostCommentModel.countDocuments({ postId: post._id })

            // Nếu là bài viết chia sẻ, lấy thông tin bài viết gốc
            let sharedPostData = null
            if (post.shared_post) {
              sharedPostData = await PostModel.findById(post.shared_post)
                .populate('userId', 'name username avatar')
                .lean()
            }

            return {
              ...post,
              likesCount,
              commentsCount,
              userLiked: !!userLiked,
              shared_post_data: sharedPostData
            }
          } catch (error: any) {
            console.error('Error processing post:', post._id, error)
            return post
          }
        })
      )

      // Trả về kết quả với định dạng phù hợp cho infinite query
      return res.status(200).json({
        message: 'Get user posts successfully',
        data: {
          posts: processedPosts,
          currentPage: pageNumber,
          totalPages: Math.ceil(total / limitNumber),
          hasMore: pageNumber < Math.ceil(total / limitNumber)
        }
      })
    } catch (error: any) {
      console.error('Error in getUserPosts:', error)
      return res.status(500).json({ message: error.message || 'Internal server error' })
    }
  }

  async updateComment(req: Request, res: Response): Promise<any> {
    try {
      const { id: commentId } = req.params
      const { content } = req.body
      const userId = req.context?.user?._id

      // Validate input
      if (!commentId || !content) {
        return res.status(400).json({ message: 'Comment ID and content are required' })
      }

      // Validate commentId format
      if (!mongoose.Types.ObjectId.isValid(commentId)) {
        return res.status(400).json({ message: 'Invalid Comment ID format' })
      }

      // Find the comment
      const comment = await PostCommentModel.findById(commentId)
      if (!comment) {
        return res.status(404).json({ message: 'Comment not found' })
      }

      // Check if user is the owner of the comment
      if (comment.userId.toString() !== userId?.toString()) {
        return res.status(403).json({ message: 'You can only edit your own comments' })
      }

      // Update the comment
      const updatedComment = await PostCommentModel.findByIdAndUpdate(
        commentId,
        { content, updatedAt: new Date() },
        { new: true }
      ).populate('userId', 'name avatar username')

      return res.status(200).json({
        message: 'Comment updated successfully',
        data: updatedComment
      })
    } catch (error: any) {
      console.error('Error updating comment:', error)
      return res.status(500).json({ message: error.message || 'Internal server error' })
    }
  }

  async deleteComment(req: Request, res: Response): Promise<any> {
    try {
      const { id: commentId } = req.params
      const userId = req.context?.user?._id

      // Validate input
      if (!commentId) {
        return res.status(400).json({ message: 'Comment ID is required' })
      }

      // Validate commentId format
      if (!mongoose.Types.ObjectId.isValid(commentId)) {
        return res.status(400).json({ message: 'Invalid Comment ID format' })
      }

      // Find the comment
      const comment = await PostCommentModel.findById(commentId)
      if (!comment) {
        return res.status(404).json({ message: 'Comment not found' })
      }

      // Check if user is the owner of the comment
      if (comment.userId.toString() !== userId?.toString()) {
        return res.status(403).json({ message: 'You can only delete your own comments' })
      }

      // Delete all replies to this comment first
      await PostCommentModel.deleteMany({ parentId: commentId })

      // Delete all likes for this comment and its replies
      await CommentLikeModel.deleteMany({ commentId: commentId })

      // Delete the comment
      await PostCommentModel.findByIdAndDelete(commentId)

      // Update comment count on the post
      await PostModel.findByIdAndUpdate(comment.postId, { $inc: { comment_count: -1 } })

      return res.status(200).json({
        message: 'Comment deleted successfully',
        data: { commentId }
      })
    } catch (error: any) {
      console.error('Error deleting comment:', error)
      return res.status(500).json({ message: error.message || 'Internal server error' })
    }
  }

  async getCommentReplies(req: Request, res: Response): Promise<any> {
    try {
      const { commentId } = req.params
      const userId = req.context?.user?._id

      console.log(`Getting replies for comment ${commentId}, user ${userId}`)

      // Lấy các reply của comment
      const replies = await PostCommentModel.find({ parentId: commentId })
        .populate('userId', 'name avatar')
        .sort({ createdAt: -1 })

      // Lấy thông tin like của người dùng hiện tại cho mỗi reply
      const repliesWithLikeInfo = await Promise.all(
        replies.map(async (reply) => {
          const likesCount = await CommentLikeModel.countDocuments({ commentId: reply._id })

          // Kiểm tra xem người dùng hiện tại đã like reply này chưa
          let userLiked = false
          if (userId) {
            const userLike = await CommentLikeModel.findOne({ commentId: reply._id, userId })
            userLiked = !!userLike
          }

          console.log(`Reply ${reply._id} - userLiked:`, userLiked, 'likesCount:', likesCount)

          return {
            ...reply.toObject(),
            likesCount,
            userLiked
          }
        })
      )

      console.log(
        'Sending replies with like info:',
        repliesWithLikeInfo.map((r) => ({
          id: r._id,
          userLiked: r.userLiked,
          likesCount: r.likesCount
        }))
      )

      return res.status(200).json({
        message: 'Get comment replies successfully',
        data: {
          data: repliesWithLikeInfo,
          pagination: {
            total: repliesWithLikeInfo.length
          }
        }
      })
    } catch (error: any) {
      console.error('Error getting comment replies:', error)
      return res.status(500).json({ message: error.message || 'Internal server error' })
    }
  }

  // Thêm phương thức xóa bài viết
  async deletePost(req: Request, res: Response, next: NextFunction): Promise<any> {
    try {
      const userId = req.context?.user?._id
      const { postId } = req.params

      if (!postId) {
        throw new AppError({
          message: 'Post ID is required',
          status: 400 // BAD_REQUEST
        })
      }

      // Kiểm tra xem postId có phải ObjectId hợp lệ không
      if (!mongoose.Types.ObjectId.isValid(postId)) {
        throw new AppError({
          message: 'Invalid Post ID format',
          status: 400 // BAD_REQUEST
        })
      }

      // Kiểm tra xem bài viết có tồn tại không
      const post = await PostModel.findById(postId)
      if (!post) {
        throw new AppError({
          message: 'Post not found',
          status: 404 // NOT_FOUND
        })
      }

      // Kiểm tra quyền xóa (chỉ người tạo bài viết mới có quyền xóa)
      if (post.userId.toString() !== userId?.toString()) {
        throw new AppError({
          message: 'You do not have permission to delete this post',
          status: 403 // FORBIDDEN
        })
      }

      // Xóa tất cả comment của bài viết
      await PostCommentModel.deleteMany({ postId })

      // Xóa tất cả like của bài viết
      await PostLikeModel.deleteMany({ postId })

      // Xóa tất cả thông báo liên quan đến bài viết
      await NotificationModel.deleteMany({ relatedId: postId })

      // Xóa tất cả bài viết chia sẻ từ bài viết này
      const sharedPosts = await PostModel.find({ shared_post: postId })
      for (const sharedPost of sharedPosts) {
        await PostModel.findByIdAndDelete(sharedPost._id)
        await PostCommentModel.deleteMany({ postId: sharedPost._id })
        await PostLikeModel.deleteMany({ postId: sharedPost._id })
        await NotificationModel.deleteMany({ relatedId: sharedPost._id })
      }

      // Xóa các file media liên quan (nếu có)
      if (post.media && post.media.length > 0) {
        for (const media of post.media) {
          if (media.public_id) {
            try {
              await uploadService.deleteFile(media.public_id)
            } catch (error) {
              console.error('Error deleting media file:', error)
            }
          }
        }
      }

      // Xóa bài viết
      await PostModel.findByIdAndDelete(postId)

      return res.status(200).json({
        message: 'Post deleted successfully',
        data: { postId }
      })
    } catch (error: any) {
      console.error('Error deleting post:', error)
      if (error instanceof AppError) {
        return next(error)
      }
      return next(
        new AppError({
          message: error.message || 'Internal server error',
          status: 500 // INTERNAL_SERVER_ERROR
        })
      )
    }
  }
}
const postController = new PostController()
export default postController
