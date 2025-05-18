import multer from 'multer'
import { Request, Response, NextFunction } from 'express'

// Cấu hình multer để cho phép tải lên cả hình ảnh và video
const storage = multer.memoryStorage()
const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif|mp4|mov|avi/
    const mimetype = filetypes.test(file.mimetype)
    const extname = filetypes.test(file.originalname.split('.').pop()?.toLowerCase() || '')

    if (mimetype && extname) {
      return cb(null, true)
    } else {
      cb(new Error('Error: File type not supported!'))
    }
  }
})

const uploadMiddleware = (req: Request, res: Response, next: NextFunction) => {
  upload.array('files')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: 'Error uploading files: ' + err })
    }
    next()
  })
}

export default uploadMiddleware
