import { Request, Response, NextFunction } from 'express'
import notificationService from '~/services/notification.service'
import { AppSuccess } from '~/models/success.model'
import { AppError } from '~/models/error.model'
import { IUser } from '~/models/user.model'

class NotificationController {
  async getNotifications(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.context?.user?._id;
      const { page = 1, limit = 10, type } = req.query;
      
      // Xây dựng query
      const query: any = { 
        userId,
        deleted: { $ne: true } // Chỉ lấy những thông báo chưa bị xóa
      };
      
      if (type) {
        query.type = type;
      }
      
      // Thực hiện query với pagination
      const options = {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        sort: { createdAt: -1 },
        populate: [
          { path: 'senderId', select: 'name avatar' }
        ]
      };
      
      const notifications = await NotificationModel.paginate(query, options);
      
      res.json(
        new AppSuccess({
          message: 'Lấy danh sách thông báo thành công',
          data: notifications
        })
      );
    } catch (error) {
      next(error);
    }
  }

  async markAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const { notificationId } = req.body
      if (!notificationId) throw new AppError({ message: 'Thiếu notificationId', status: 400 })
      const notification = await notificationService.markAsRead(notificationId)
      res.json(new AppSuccess({ data: notification, message: 'Đã đánh dấu đã đọc' }))
    } catch (err) {
      next(err)
    }
  }

  async markAllAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = (req.context?.user as IUser)._id as string
      await notificationService.markAllAsRead(userId)
      res.json(new AppSuccess({ data: null, message: 'Đã đánh dấu tất cả đã đọc' }))
    } catch (err) {
      next(err)
    }
  }

  async deleteNotification(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.context?.user?._id;
      const { notificationId } = req.params;

      // Tìm thông báo
      const notification = await NotificationModel.findOne({
        _id: notificationId,
        userId
      });

      if (!notification) {
        throw new AppError({
          message: 'Không tìm thấy thông báo',
          status: 404
        });
      }

      // Thay vì xóa hoàn toàn, đánh dấu là đã xóa
      notification.deleted = true;
      await notification.save();

      // Hoặc nếu muốn xóa hoàn toàn
      // await NotificationModel.findByIdAndDelete(notificationId);

      res.json(
        new AppSuccess({
          message: 'Đã xóa thông báo',
          data: { notificationId }
        })
      );
    } catch (error) {
      next(error);
    }
  }
}

const notificationController = new NotificationController()
export default notificationController
