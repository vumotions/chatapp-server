import multer from 'multer'
import { Request, Response, NextFunction } from 'express'
import { AppError } from '~/models/error.model'

// Cấu hình multer để cho phép tải lên cả hình ảnh và video
const storage = multer.memoryStorage()
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // Giới hạn kích thước file 10MB
  },
  fileFilter: (req, file, cb) => {
    console.log('Multer processing file:', file.originalname, file.mimetype)
    const filetypes = /jpeg|jpg|png|gif|mp4|mov|avi|pdf|doc|docx|xls|xlsx|txt|csv/
    const mimetype = filetypes.test(file.mimetype)
    const extname = filetypes.test(file.originalname.split('.').pop()?.toLowerCase() || '')

    if (mimetype && extname) {
      return cb(null, true)
    } else {
      cb(
        new Error(
          'Error: File type not supported! Only jpeg, jpg, png, gif, mp4, mov, avi, pdf, doc, docx, xls, xlsx, txt, csv are allowed.'
        )
      )
    }
  }
})

const uploadMiddleware = (req: Request, res: Response, next: NextFunction) => {
  console.log('Upload middleware called')
  console.log('Request headers:', req.headers)
  console.log('Content-Type:', req.headers['content-type'])
  console.log('Request body before multer:', req.body)

  // Sử dụng single thay vì array để test
  upload.array('files', 5)(req, res, (err) => {
    if (err) {
      console.error('Upload middleware error:', err)

      // Xử lý các loại lỗi cụ thể
      if (err instanceof multer.MulterError) {
        // Lỗi từ Multer
        console.error('Multer error code:', err.code)
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(403).json(
            new AppError({
              message: 'File quá lớn. Kích thước tối đa cho phép là 10MB.',
              status: 403
            })
          )
        } else if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(403).json(
            new AppError({
              message: 'Số lượng file vượt quá giới hạn. Tối đa 5 file được phép tải lên.',
              status: 403
            })
          )
        } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(403).json(
            new AppError({
              message: 'Tên trường không đúng. Vui lòng sử dụng trường "files".',
              status: 403
            })
          )
        }
      } else if (err.message.includes('File type not supported')) {
        // Lỗi định dạng file không được hỗ trợ
        return res.status(403).json(
          new AppError({
            message:
              'Định dạng file không được hỗ trợ. Chỉ chấp nhận các định dạng: jpeg, jpg, png, gif, mp4, mov, avi, pdf, doc, docx, xls, xlsx, txt, csv.',
            status: 403
          })
        )
      }

      // Lỗi khác
      return res.status(403).json(
        new AppError({
          message: err.message || 'Lỗi khi tải lên file',
          status: 403
        })
      )
    }

    // Log thông tin về các file đã tải lên
    console.log('Request after multer processing:')
    console.log('- req.body:', req.body)
    console.log('- req.file:', req.file)
    console.log('- req.files:', req.files)

    const files = req.files as Express.Multer.File[]
    console.log(
      `Received ${files?.length || 0} files:`,
      files?.map((f) => ({
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.size
      }))
    )

    next()
  })
}

export default uploadMiddleware
